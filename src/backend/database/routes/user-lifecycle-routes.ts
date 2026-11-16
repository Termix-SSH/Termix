import crypto from "crypto";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import type { Request, RequestHandler, Response, Router } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import {
  createCurrentRoleRepository,
  createCurrentSettingsRepository,
  createCurrentUserInviteRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";
import {
  isUsernameTaken,
  type UserRecord,
} from "../repositories/user-repository.js";
import { authLogger } from "../../utils/logger.js";
import {
  AccountError,
  disableAccount,
  enableAccount,
} from "../../auth/account-lifecycle.js";
import {
  auditSettingChange,
  getAuditUsername,
  getRequestMeta,
  logAudit,
} from "../../utils/audit-logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import {
  isAcceptableUsername,
  USERNAME_RULE_ERROR,
} from "../../utils/username.js";
import {
  createHold,
  getHoldSettings,
  holdIfNeeded,
  registerHoldKind,
} from "../../auth/admin-holds.js";
import {
  actorHas,
  canManageAccount,
  canViewUsers,
  USERS_MANAGE,
} from "../../auth/user-admin-access.js";
import {
  ADMIN_HOST_BYPASS_SETTING,
  adminHostBypassEnabled,
  DISABLED_REASON_ADMIN,
  DISABLED_REASON_PENDING,
  EXTERNAL_SIGNUP_APPROVAL_SETTING,
  externalSignupApprovalRequired,
} from "../../auth/user-access-settings.js";
import { promoteToAdmin } from "./user-admin-routes.js";
import { readProfileInput } from "../../auth/profile-input.js";

export { readProfileInput };

const INVITE_MAX_USES = 100;
const INVITE_MAX_HOURS = 24 * 30;
const INVITE_DEFAULT_HOURS = 72;

async function setAdminHostBypass(enabled: boolean): Promise<void> {
  await createCurrentSettingsRepository().set(
    ADMIN_HOST_BYPASS_SETTING,
    enabled ? "true" : "false",
  );
}

registerHoldKind("admin_host_bypass_on", {
  apply: async () => setAdminHostBypass(true),
});

function hashInviteToken(token: string): string {
  return `sha256:${crypto.createHash("sha256").update(token).digest("hex")}`;
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  return String(Array.isArray(value) ? value[0] : value);
}

async function saveProfile(
  res: Response,
  userId: string,
  update: { displayName?: string | null; email?: string | null },
): Promise<UserRecord | null> {
  const users = createCurrentUserRepository();
  if (update.email) {
    const holder = await users.findByEmail(update.email);
    if (holder && holder.id !== userId) {
      res.status(409).json({ error: "That email is already in use" });
      return null;
    }
  }
  try {
    const saved = await users.update(userId, update);
    if (!saved) {
      res.status(404).json({ error: "User not found" });
      return null;
    }
    return saved;
  } catch (error) {
    if (isUsernameTaken(error)) {
      res.status(409).json({ error: "That email is already in use" });
      return null;
    }
    throw error;
  }
}

function profileBody(user: UserRecord) {
  return {
    userId: user.id,
    username: user.username,
    display_name: user.displayName ?? null,
    email: user.email ?? null,
  };
}

/** Role ids from a request body, or an error message. */
function readRoleIds(raw: unknown): number[] | string {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((id) => !Number.isInteger(id))) {
    return "roleIds must be a list of role ids";
  }
  return Array.from(new Set(raw as number[]));
}

function parseRoleIds(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is number => Number.isInteger(id))
      : [];
  } catch {
    return [];
  }
}

function inviteState(invite: {
  revokedAt: string | null;
  expiresAt: string;
  uses: number;
  maxUses: number;
}): "active" | "revoked" | "expired" | "used" {
  if (invite.revokedAt) return "revoked";
  if (new Date(invite.expiresAt).getTime() <= Date.now()) return "expired";
  if (invite.uses >= invite.maxUses) return "used";
  return "active";
}

/** Gives a new account the invite's roles and fills its shared secrets. */
async function applyInviteRoles(
  userId: string,
  roleIds: number[],
  grantedBy: string | null,
): Promise<void> {
  const roles = createCurrentRoleRepository();
  for (const roleId of roleIds) {
    const role = await roles.findRoleById(roleId);
    if (!role || role.isSystem) continue;
    await roles.assignRoleToUser({
      userId,
      roleId,
      grantedBy: grantedBy ?? userId,
    });
    try {
      const { SharedHostSecretsManager } =
        await import("../../utils/shared-host-secrets-manager.js");
      await SharedHostSecretsManager.getInstance().snapshotForRoleMember(
        roleId,
        userId,
      );
      const { SharedCredentialSecretsManager } =
        await import("../../utils/shared-credential-secrets-manager.js");
      await SharedCredentialSecretsManager.getInstance().snapshotForRoleMember(
        roleId,
        userId,
      );
    } catch (error) {
      authLogger.warn("Failed to share role secrets with an invited user", {
        operation: "invite_role_snapshot",
        userId,
        roleId,
        error,
      });
    }
  }
  PermissionManager.getInstance().invalidateUserPermissionCache(userId);
}

export function registerUserLifecycleRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /users/admin-host-bypass:
   *   get:
   *     summary: Get whether admins can open other users' hosts
   *     description: When on, admins can see, open and change every user's hosts and act on their data from the admin panel. Every such use is audited.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: The current setting.
   */
  router.get("/admin-host-bypass", authenticateJWT, (_req, res) => {
    res.json({ enabled: adminHostBypassEnabled() });
  });

  /**
   * @openapi
   * /users/admin-host-bypass:
   *   patch:
   *     summary: Set whether admins can open other users' hosts (admin only)
   *     description: Turning it off takes effect at once. Turning it on waits out the admin cooling-off time when that is set.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               enabled:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Setting saved.
   *       202:
   *         description: Turning it on waits for the cooling-off time.
   *       400:
   *         description: enabled must be true or false.
   *       403:
   *         description: Admin access required.
   *       500:
   *         description: Failed to save the setting.
   */
  router.patch("/admin-host-bypass", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      if (!(await PermissionManager.getInstance().isAdmin(userId))) {
        return res.status(403).json({ error: "Admin access required" });
      }
      const { enabled } = req.body ?? {};
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled must be true or false" });
      }
      if (
        enabled &&
        !adminHostBypassEnabled() &&
        (await holdIfNeeded(req, res, {
          kind: "admin_host_bypass_on",
          payload: {},
          summary: "let admins open other users' hosts",
          requesterId: userId,
        }))
      ) {
        return;
      }
      await setAdminHostBypass(enabled);
      await auditSettingChange(req, ADMIN_HOST_BYPASS_SETTING, enabled);
      res.json({ enabled });
    } catch (err) {
      authLogger.error("Failed to set the admin host access setting", err);
      res.status(500).json({ error: "Failed to save the setting" });
    }
  });

  /**
   * @openapi
   * /users/external-signup-approval:
   *   get:
   *     summary: Get whether new external accounts need approval
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: The current setting.
   *   patch:
   *     summary: Set whether new external accounts need approval (admin only)
   *     description: When on, someone signing in through SSO or LDAP for the first time gets an account that stays off until an admin approves it.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               enabled:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Setting saved.
   *       400:
   *         description: enabled must be true or false.
   *       403:
   *         description: Admin access required.
   *       500:
   *         description: Failed to save the setting.
   */
  router.get("/external-signup-approval", authenticateJWT, (_req, res) => {
    res.json({ enabled: externalSignupApprovalRequired() });
  });
  router.patch(
    "/external-signup-approval",
    authenticateJWT,
    async (req, res) => {
      const userId = (req as AuthenticatedRequest).userId;
      try {
        if (!(await PermissionManager.getInstance().isAdmin(userId))) {
          return res.status(403).json({ error: "Admin access required" });
        }
        const { enabled } = req.body ?? {};
        if (typeof enabled !== "boolean") {
          return res
            .status(400)
            .json({ error: "enabled must be true or false" });
        }
        await createCurrentSettingsRepository().set(
          EXTERNAL_SIGNUP_APPROVAL_SETTING,
          enabled ? "true" : "false",
        );
        await auditSettingChange(
          req,
          EXTERNAL_SIGNUP_APPROVAL_SETTING,
          enabled,
        );
        res.json({ enabled });
      } catch (err) {
        authLogger.error("Failed to set the signup approval setting", err);
        res.status(500).json({ error: "Failed to save the setting" });
      }
    },
  );

  /**
   * @openapi
   * /users/admin/{userId}/disable:
   *   post:
   *     summary: Turn an account off
   *     description: Signs the user out everywhere, stops their API keys and blocks every login until the account is turned back on. Needs admin.users.manage; only admins can turn off an admin.
   *     tags:
   *       - Users
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Account turned off.
   *       400:
   *         description: You can't turn off your own account or the last admin.
   *       403:
   *         description: Not authorized.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to turn off the account.
   */
  router.post("/admin/:userId/disable", authenticateJWT, async (req, res) => {
    const actorId = (req as AuthenticatedRequest).userId;
    const targetId = param(req, "userId");
    try {
      const users = createCurrentUserRepository();
      const target = await users.findById(targetId);
      if (!target) return res.status(404).json({ error: "User not found" });
      if (!(await canManageAccount(actorId, target))) {
        return res.status(403).json({ error: "Not authorized" });
      }
      if (target.id === actorId) {
        return res
          .status(400)
          .json({ error: "You can't turn off your own account" });
      }
      try {
        if (!(await disableAccount(target, DISABLED_REASON_ADMIN))) {
          return res.json({ disabled: true });
        }
      } catch (error) {
        if (error instanceof AccountError && error.code === "last_admin") {
          return res.status(400).json({ error: error.message });
        }
        throw error;
      }

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId: actorId,
        username: await getAuditUsername(actorId),
        action: "disable_user",
        resourceType: "user",
        resourceId: target.id,
        resourceName: target.username,
        ipAddress,
        userAgent,
        success: true,
      });
      res.json({ disabled: true });
    } catch (err) {
      authLogger.error("Failed to turn off an account", err);
      res.status(500).json({ error: "Failed to turn off the account" });
    }
  });

  /**
   * @openapi
   * /users/admin/{userId}/enable:
   *   post:
   *     summary: Turn an account back on, or approve a waiting one
   *     description: Needs admin.users.manage; only admins can turn an admin back on.
   *     tags:
   *       - Users
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Account is on.
   *       403:
   *         description: Not authorized.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to turn on the account.
   */
  router.post("/admin/:userId/enable", authenticateJWT, async (req, res) => {
    const actorId = (req as AuthenticatedRequest).userId;
    const targetId = param(req, "userId");
    try {
      const users = createCurrentUserRepository();
      const target = await users.findById(targetId);
      if (!target) return res.status(404).json({ error: "User not found" });
      if (!(await canManageAccount(actorId, target))) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const wasPending = target.disabledReason === DISABLED_REASON_PENDING;
      if (!(await enableAccount(target))) return res.json({ disabled: false });

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId: actorId,
        username: await getAuditUsername(actorId),
        action: wasPending ? "approve_user" : "enable_user",
        resourceType: "user",
        resourceId: target.id,
        resourceName: target.username,
        ipAddress,
        userAgent,
        success: true,
      });
      res.json({ disabled: false });
    } catch (err) {
      authLogger.error("Failed to turn on an account", err);
      res.status(500).json({ error: "Failed to turn on the account" });
    }
  });

  /**
   * @openapi
   * /users/me/profile:
   *   patch:
   *     summary: Change your display name or email
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               displayName:
   *                 type: string
   *                 nullable: true
   *               email:
   *                 type: string
   *                 nullable: true
   *     responses:
   *       200:
   *         description: Profile saved.
   *       400:
   *         description: Invalid display name or email.
   *       409:
   *         description: The email is already in use.
   *       500:
   *         description: Failed to save the profile.
   */
  router.patch("/me/profile", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const input = readProfileInput(req.body);
    if ("error" in input) return res.status(400).json({ error: input.error });
    try {
      const saved = await saveProfile(res, userId, input.update);
      if (!saved) return;
      res.json(profileBody(saved));
    } catch (err) {
      authLogger.error("Failed to save a profile", err);
      res.status(500).json({ error: "Failed to save the profile" });
    }
  });

  /**
   * @openapi
   * /users/admin/{userId}/profile:
   *   patch:
   *     summary: Change a user's display name or email
   *     description: Needs admin.users.manage; only admins can change an admin.
   *     tags:
   *       - Users
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               displayName:
   *                 type: string
   *                 nullable: true
   *               email:
   *                 type: string
   *                 nullable: true
   *     responses:
   *       200:
   *         description: Profile saved.
   *       400:
   *         description: Invalid display name or email.
   *       403:
   *         description: Not authorized.
   *       404:
   *         description: User not found.
   *       409:
   *         description: The email is already in use.
   *       500:
   *         description: Failed to save the profile.
   */
  router.patch("/admin/:userId/profile", authenticateJWT, async (req, res) => {
    const actorId = (req as AuthenticatedRequest).userId;
    const input = readProfileInput(req.body);
    if ("error" in input) return res.status(400).json({ error: input.error });
    try {
      const target = await createCurrentUserRepository().findById(
        param(req, "userId"),
      );
      if (!target) return res.status(404).json({ error: "User not found" });
      if (!(await canManageAccount(actorId, target))) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const saved = await saveProfile(res, target.id, input.update);
      if (!saved) return;
      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId: actorId,
        username: await getAuditUsername(actorId),
        action: "update_user_profile",
        resourceType: "user",
        resourceId: target.id,
        resourceName: target.username,
        ipAddress,
        userAgent,
        success: true,
      });
      res.json(profileBody(saved));
    } catch (err) {
      authLogger.error("Failed to save a profile", err);
      res.status(500).json({ error: "Failed to save the profile" });
    }
  });

  /**
   * @openapi
   * /users/invites:
   *   get:
   *     summary: List invite links
   *     description: Needs admin.users.view. Tokens are never shown again.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Invites, newest first.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Failed to list invites.
   */
  router.get("/invites", authenticateJWT, async (req, res) => {
    const actorId = (req as AuthenticatedRequest).userId;
    try {
      if (!(await canViewUsers(actorId))) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const invites = await createCurrentUserInviteRepository().list();
      res.json({
        invites: invites.map((invite) => ({
          id: invite.id,
          note: invite.note,
          roleIds: parseRoleIds(invite.roleIds),
          makeAdmin: !!invite.makeAdmin,
          maxUses: invite.maxUses,
          uses: invite.uses,
          createdBy: invite.createdByUsername,
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
          revokedAt: invite.revokedAt,
          state: inviteState(invite),
        })),
      });
    } catch (err) {
      authLogger.error("Failed to list invites", err);
      res.status(500).json({ error: "Failed to list invites" });
    }
  });

  /**
   * @openapi
   * /users/invites:
   *   post:
   *     summary: Make an invite link
   *     description: Needs admin.users.manage. The link works even when sign up is off. Only admins can give admin or roles with permissions they don't hold.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               note:
   *                 type: string
   *               roleIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *               makeAdmin:
   *                 type: boolean
   *               maxUses:
   *                 type: integer
   *                 minimum: 1
   *                 maximum: 100
   *               expiresInHours:
   *                 type: integer
   *                 minimum: 1
   *                 maximum: 720
   *     responses:
   *       200:
   *         description: The invite and its token, shown only this once.
   *       400:
   *         description: Invalid input.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Failed to make the invite.
   */
  router.post("/invites", authenticateJWT, async (req, res) => {
    const actorId = (req as AuthenticatedRequest).userId;
    try {
      if (!(await actorHas(actorId, USERS_MANAGE))) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const permissions = PermissionManager.getInstance();
      const actorIsAdmin = await permissions.isAdmin(actorId);

      const makeAdmin = body.makeAdmin === true;
      if (makeAdmin && !actorIsAdmin) {
        return res
          .status(403)
          .json({ error: "Only admins can invite another admin" });
      }

      const roleIds = readRoleIds(body.roleIds);
      if (typeof roleIds === "string") {
        return res.status(400).json({ error: roleIds });
      }
      const roles = createCurrentRoleRepository();
      for (const roleId of roleIds) {
        const role = await roles.findRoleById(roleId);
        if (!role || role.isSystem) {
          return res.status(400).json({ error: "Unknown role" });
        }
        if (!actorIsAdmin) {
          let held: string[] = [];
          try {
            held = JSON.parse(role.permissions ?? "[]") as string[];
          } catch {
            held = [];
          }
          for (const permission of held) {
            if (!(await permissions.hasPermission(actorId, permission))) {
              return res.status(403).json({
                error: "You can only grant permissions you have yourself",
                code: "PERMISSION_NOT_HELD",
              });
            }
          }
        }
      }

      const maxUses =
        body.maxUses === undefined ? 1 : Math.floor(Number(body.maxUses));
      if (
        !Number.isFinite(maxUses) ||
        maxUses < 1 ||
        maxUses > INVITE_MAX_USES
      ) {
        return res
          .status(400)
          .json({ error: `maxUses must be 1 to ${INVITE_MAX_USES}` });
      }
      const hours =
        body.expiresInHours === undefined
          ? INVITE_DEFAULT_HOURS
          : Math.floor(Number(body.expiresInHours));
      if (!Number.isFinite(hours) || hours < 1 || hours > INVITE_MAX_HOURS) {
        return res
          .status(400)
          .json({ error: `expiresInHours must be 1 to ${INVITE_MAX_HOURS}` });
      }
      const note =
        typeof body.note === "string" && body.note.trim()
          ? body.note.trim().slice(0, 200)
          : null;

      const token = `tmi_${crypto.randomBytes(24).toString("base64url")}`;
      const invite = await createCurrentUserInviteRepository().create({
        id: nanoid(),
        tokenHash: hashInviteToken(token),
        note,
        roleIds: roleIds.length ? JSON.stringify(roleIds) : null,
        makeAdmin,
        maxUses,
        uses: 0,
        createdBy: actorId,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId: actorId,
        username: await getAuditUsername(actorId),
        action: "create_user_invite",
        resourceType: "invite",
        resourceId: invite.id,
        resourceName: note ?? invite.id,
        details: JSON.stringify({ roleIds, makeAdmin, maxUses, hours }),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({
        id: invite.id,
        token,
        expiresAt: invite.expiresAt,
        maxUses,
      });
    } catch (err) {
      authLogger.error("Failed to make an invite", err);
      res.status(500).json({ error: "Failed to make the invite" });
    }
  });

  /**
   * @openapi
   * /users/invites/{id}:
   *   delete:
   *     summary: Revoke an invite link
   *     description: Needs admin.users.manage.
   *     tags:
   *       - Users
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Invite revoked.
   *       403:
   *         description: Not authorized.
   *       404:
   *         description: Invite not found.
   *       500:
   *         description: Failed to revoke the invite.
   */
  router.delete("/invites/:id", authenticateJWT, async (req, res) => {
    const actorId = (req as AuthenticatedRequest).userId;
    try {
      if (!(await actorHas(actorId, USERS_MANAGE))) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const invites = createCurrentUserInviteRepository();
      const invite = await invites.findById(param(req, "id"));
      if (!invite) return res.status(404).json({ error: "Invite not found" });
      await invites.revoke(invite.id);
      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId: actorId,
        username: await getAuditUsername(actorId),
        action: "revoke_user_invite",
        resourceType: "invite",
        resourceId: invite.id,
        resourceName: invite.note ?? invite.id,
        ipAddress,
        userAgent,
        success: true,
      });
      res.json({ revoked: true });
    } catch (err) {
      authLogger.error("Failed to revoke an invite", err);
      res.status(500).json({ error: "Failed to revoke the invite" });
    }
  });

  /**
   * @openapi
   * /users/invites/redeem/{token}:
   *   get:
   *     summary: Check an invite link
   *     description: Public. Says only whether the link can still be used.
   *     tags:
   *       - Users
   *     parameters:
   *       - in: path
   *         name: token
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Whether the invite is usable.
   */
  router.get("/invites/redeem/:token", async (req, res) => {
    try {
      const invite = await createCurrentUserInviteRepository().findByTokenHash(
        hashInviteToken(param(req, "token")),
      );
      const state = invite ? inviteState(invite) : "invalid";
      res.json({ valid: state === "active", state });
    } catch (err) {
      authLogger.error("Failed to check an invite", err);
      res.status(500).json({ error: "Failed to check the invite" });
    }
  });

  /**
   * @openapi
   * /users/invites/redeem/{token}/accept:
   *   post:
   *     summary: Make an account from an invite link
   *     description: Public. Works even when sign up is off. The new account gets the invite's roles, then signs in like any other.
   *     tags:
   *       - Users
   *     parameters:
   *       - in: path
   *         name: token
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               username:
   *                 type: string
   *               password:
   *                 type: string
   *     responses:
   *       200:
   *         description: Account made.
   *       400:
   *         description: Invalid username or password.
   *       404:
   *         description: The invite can't be used.
   *       409:
   *         description: Username already exists.
   *       500:
   *         description: Failed to make the account.
   */
  router.post("/invites/redeem/:token/accept", async (req, res) => {
    const { username, password } = (req.body ?? {}) as Record<string, unknown>;
    if (
      typeof username !== "string" ||
      !username.trim() ||
      typeof password !== "string" ||
      !password
    ) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }
    if (!isAcceptableUsername(username)) {
      return res.status(400).json({ error: USERNAME_RULE_ERROR });
    }

    const invites = createCurrentUserInviteRepository();
    const users = createCurrentUserRepository();
    let claimedId: string | null = null;
    let createdId: string | null = null;
    try {
      const invite = await invites.findByTokenHash(
        hashInviteToken(param(req, "token")),
      );
      if (!invite || inviteState(invite) !== "active") {
        return res.status(404).json({
          error: "This invite link can't be used",
          code: "INVITE_INVALID",
        });
      }
      if (await users.findByUsername(username)) {
        return res.status(409).json({ error: "Username already exists" });
      }
      if (!(await invites.claimUse(invite.id))) {
        return res.status(404).json({
          error: "This invite link can't be used",
          code: "INVITE_INVALID",
        });
      }
      claimedId = invite.id;

      const id = nanoid();
      await users.create({
        id,
        username,
        passwordHash: await bcrypt.hash(password, 10),
        isAdmin: false,
      });
      createdId = id;
      await createCurrentRoleRepository().assignRoleNameToUser({
        userId: id,
        roleName: "user",
        grantedBy: invite.createdBy ?? id,
      });
      await AuthManager.getInstance().registerUser(id, password);
      await applyInviteRoles(
        id,
        parseRoleIds(invite.roleIds),
        invite.createdBy,
      );

      // An admin invite still goes through the cooling-off wait.
      if (invite.makeAdmin && invite.createdBy) {
        const holds = await getHoldSettings();
        if (holds.active) {
          await createHold({
            kind: "make_admin",
            payload: { userId: id },
            summary: `make ${username} an admin (invite)`,
            requesterId: invite.createdBy,
            minutes: holds.minutes,
            req,
          });
        } else {
          await promoteToAdmin(invite.createdBy, id, getRequestMeta(req));
        }
      }
      await DatabaseSaveTrigger.forceSave("invite_accept").catch(() => {});

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId: id,
        username,
        action: "accept_user_invite",
        resourceType: "user",
        resourceId: id,
        resourceName: username,
        details: JSON.stringify({ inviteId: invite.id }),
        ipAddress,
        userAgent,
        success: true,
      });
      res.json({ message: "Account created", userId: id });
    } catch (err) {
      if (createdId) {
        await users.delete(createdId).catch(() => {});
      }
      if (claimedId) {
        await invites.releaseUse(claimedId).catch(() => {});
      }
      if (isUsernameTaken(err)) {
        return res.status(409).json({ error: "Username already exists" });
      }
      authLogger.error("Failed to accept an invite", err);
      res.status(500).json({ error: "Failed to make the account" });
    }
  });
}
