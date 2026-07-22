import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import {
  PermissionManager,
  SHARE_PERMISSION_LEVELS,
  type SharePermissionLevel,
} from "../../utils/permission-manager.js";
import {
  PERMISSION_CATALOG,
  isValidPermission,
} from "../../utils/permission-catalog.js";
import {
  createCurrentCredentialRepository,
  createCurrentHostFolderRepository,
  createCurrentHostResolutionRepository,
  createCurrentRbacAccessRepository,
  createCurrentRoleRepository,
  createCurrentSnippetRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";

const router = express.Router();

const authManager = AuthManager.getInstance();
const permissionManager = PermissionManager.getInstance();

const authenticateJWT = authManager.createAuthMiddleware();

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSharePermissionLevel(value: unknown): value is SharePermissionLevel {
  return SHARE_PERMISSION_LEVELS.includes(value as SharePermissionLevel);
}

function expiryFromDuration(durationHours: unknown): string | null {
  if (durationHours && typeof durationHours === "number" && durationHours > 0) {
    const expiryDate = new Date();
    expiryDate.setTime(expiryDate.getTime() + durationHours * 60 * 60 * 1000);
    return expiryDate.toISOString();
  }
  return null;
}

// Sharing is controlled by the owner or any recipient holding "manage".
async function canManageHostSharing(
  userId: string,
  hostId: number,
): Promise<{ allowed: boolean; isOwner: boolean }> {
  const access = await permissionManager.canAccessHost(
    userId,
    hostId,
    "manage",
  );
  return { allowed: access.hasAccess, isOwner: access.isOwner };
}

interface ShareTarget {
  type: "user" | "role";
  id: string | number;
}

function parseShareTargets(
  body: Record<string, unknown>,
): ShareTarget[] | null {
  const rawTargets = body.targets;
  if (!Array.isArray(rawTargets) || rawTargets.length === 0) return null;

  const targets: ShareTarget[] = [];
  for (const raw of rawTargets) {
    if (!raw || typeof raw !== "object") return null;
    const { type, id } = raw as { type?: unknown; id?: unknown };
    if (type === "user" && isNonEmptyString(id)) {
      targets.push({ type: "user", id });
    } else if (
      type === "role" &&
      typeof id === "number" &&
      Number.isInteger(id)
    ) {
      targets.push({ type: "role", id });
    } else {
      return null;
    }
  }

  return targets;
}

/**
 * @openapi
 * /rbac/host/{id}/share:
 *   post:
 *     summary: Share a host
 *     description: Shares a host with one or more users and/or roles at a permission level (connect, view, edit, manage). Allowed for the host owner or recipients holding the manage level. Every auth type is shareable; per-recipient secret snapshots are created automatically.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targets]
 *             properties:
 *               targets:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [user, role]
 *                     id:
 *                       oneOf:
 *                         - type: string
 *                         - type: integer
 *               permissionLevel:
 *                 type: string
 *                 enum: [connect, view, edit, manage]
 *               durationHours:
 *                 type: number
 *     responses:
 *       200:
 *         description: Host shared successfully.
 *       400:
 *         description: Invalid request body.
 *       403:
 *         description: Caller may not share this host.
 *       404:
 *         description: Target user or role not found.
 *       500:
 *         description: Failed to share host.
 */
router.post(
  "/host/:id/share",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const hostId = parseInt(id, 10);
    const userId = req.userId!;

    if (isNaN(hostId)) {
      return res.status(400).json({ error: "Invalid host ID" });
    }

    try {
      const targets = parseShareTargets(req.body ?? {});
      if (!targets) {
        return res.status(400).json({
          error:
            "targets must be a non-empty array of { type: 'user'|'role', id } entries",
        });
      }

      const { durationHours, permissionLevel = "connect" } = req.body;

      if (!isSharePermissionLevel(permissionLevel)) {
        return res.status(400).json({
          error: "Invalid permission level",
          validLevels: SHARE_PERMISSION_LEVELS,
        });
      }

      const sharing = await canManageHostSharing(userId, hostId);
      if (!sharing.allowed) {
        databaseLogger.warn("Permission denied", {
          operation: "rbac_permission_denied",
          userId,
          resource: "host",
          resourceId: hostId,
          action: "share",
        });
        return res.status(403).json({ error: "You may not share this host" });
      }

      const host =
        await createCurrentHostResolutionRepository().findHostUpdateState(
          hostId,
        );
      if (!host) {
        return res.status(404).json({ error: "Host not found" });
      }
      const ownerId = host.userId;

      const userRepository = createCurrentUserRepository();
      const roleRepository = createCurrentRoleRepository();

      for (const target of targets) {
        if (target.type === "user") {
          if (target.id === ownerId) {
            return res
              .status(400)
              .json({ error: "Cannot share a host with its owner" });
          }
          const targetUser = await userRepository.findById(target.id as string);
          if (!targetUser) {
            return res.status(404).json({
              error: "Target user not found",
              targetId: target.id,
            });
          }
        } else {
          const targetRole = await roleRepository.findRoleById(
            target.id as number,
          );
          if (!targetRole) {
            return res.status(404).json({
              error: "Target role not found",
              targetId: target.id,
            });
          }
        }
      }

      const expiresAt = expiryFromDuration(durationHours);

      const rbacAccessRepository = createCurrentRbacAccessRepository();
      const { SharedHostSecretsManager } =
        await import("../../utils/shared-host-secrets-manager.js");
      const secretsManager = SharedHostSecretsManager.getInstance();

      const results: Array<{
        type: "user" | "role";
        id: string | number;
        accessId: number;
        created: boolean;
      }> = [];

      for (const target of targets) {
        const accessGrant = await rbacAccessRepository.upsertHostAccess({
          hostId,
          grantedBy: userId,
          permissionLevel,
          expiresAt,
          ...(target.type === "user"
            ? { targetType: "user" as const, targetUserId: target.id as string }
            : {
                targetType: "role" as const,
                targetRoleId: target.id as number,
              }),
        });

        try {
          if (target.type === "user") {
            await secretsManager.snapshotForUser(
              accessGrant.id,
              hostId,
              target.id as string,
              ownerId,
            );
          } else {
            await secretsManager.snapshotForRole(
              accessGrant.id,
              hostId,
              target.id as number,
              ownerId,
            );
          }
        } catch (snapshotError) {
          databaseLogger.warn("Share created but secret snapshot failed", {
            operation: "rbac_host_share_snapshot_failed",
            hostId,
            accessId: accessGrant.id,
            error:
              snapshotError instanceof Error
                ? snapshotError.message
                : "Unknown error",
          });
        }

        results.push({
          type: target.type,
          id: target.id,
          accessId: accessGrant.id,
          created: accessGrant.created,
        });
      }

      databaseLogger.success("Host shared successfully", {
        operation: "rbac_host_share_success",
        userId,
        hostId,
        targets: results.length,
        permissionLevel,
      });

      res.json({
        success: true,
        message: "Host shared successfully",
        permissionLevel,
        expiresAt,
        results,
      });
    } catch (error) {
      databaseLogger.error("Failed to share host", error, {
        operation: "share_host",
        hostId,
        userId,
      });
      res.status(500).json({ error: "Failed to share host" });
    }
  },
);

/**
 * @openapi
 * /rbac/folder/share:
 *   post:
 *     summary: Share all hosts in a folder
 *     description: Shares every host within a folder (and its subfolders) with one or more users and/or roles at a permission level. Only hosts owned by the caller are shared; skips hosts the caller may not share.
 *     tags:
 *       - RBAC
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [folder, targets]
 *             properties:
 *               folder:
 *                 type: string
 *               targets:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [user, role]
 *                     id:
 *                       oneOf:
 *                         - type: string
 *                         - type: integer
 *               permissionLevel:
 *                 type: string
 *                 enum: [connect, view, edit, manage]
 *               durationHours:
 *                 type: number
 *     responses:
 *       200:
 *         description: Folder shared successfully.
 *       400:
 *         description: Invalid request body.
 *       404:
 *         description: Folder has no hosts.
 *       500:
 *         description: Failed to share folder.
 */
router.post(
  "/folder/share",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId!;
    const { folder } = req.body ?? {};

    if (!isNonEmptyString(folder)) {
      return res.status(400).json({ error: "Folder name is required" });
    }

    try {
      const targets = parseShareTargets(req.body ?? {});
      if (!targets) {
        return res.status(400).json({
          error:
            "targets must be a non-empty array of { type: 'user'|'role', id } entries",
        });
      }

      const { durationHours, permissionLevel = "connect" } = req.body;

      if (!isSharePermissionLevel(permissionLevel)) {
        return res.status(400).json({
          error: "Invalid permission level",
          validLevels: SHARE_PERMISSION_LEVELS,
        });
      }

      const userRepository = createCurrentUserRepository();
      const roleRepository = createCurrentRoleRepository();
      for (const target of targets) {
        if (target.type === "user") {
          const targetUser = await userRepository.findById(target.id as string);
          if (!targetUser) {
            return res.status(404).json({
              error: "Target user not found",
              targetId: target.id,
            });
          }
        } else {
          const targetRole = await roleRepository.findRoleById(
            target.id as number,
          );
          if (!targetRole) {
            return res.status(404).json({
              error: "Target role not found",
              targetId: target.id,
            });
          }
        }
      }

      const hostsInFolder =
        await createCurrentHostFolderRepository().listHostsInFolder(
          userId,
          folder,
        );
      if (hostsInFolder.length === 0) {
        return res.status(404).json({ error: "Folder has no hosts" });
      }

      const expiresAt = expiryFromDuration(durationHours);
      const rbacAccessRepository = createCurrentRbacAccessRepository();
      const { SharedHostSecretsManager } =
        await import("../../utils/shared-host-secrets-manager.js");
      const secretsManager = SharedHostSecretsManager.getInstance();

      const hostResults: Array<{
        hostId: number;
        shared: boolean;
        reason?: string;
      }> = [];

      for (const host of hostsInFolder) {
        if (targets.some((t) => t.type === "user" && t.id === host.userId)) {
          hostResults.push({
            hostId: host.id,
            shared: false,
            reason: "owner",
          });
          continue;
        }

        const sharing = await canManageHostSharing(userId, host.id);
        if (!sharing.allowed) {
          hostResults.push({
            hostId: host.id,
            shared: false,
            reason: "forbidden",
          });
          continue;
        }

        for (const target of targets) {
          const accessGrant = await rbacAccessRepository.upsertHostAccess({
            hostId: host.id,
            grantedBy: userId,
            permissionLevel,
            expiresAt,
            ...(target.type === "user"
              ? {
                  targetType: "user" as const,
                  targetUserId: target.id as string,
                }
              : {
                  targetType: "role" as const,
                  targetRoleId: target.id as number,
                }),
          });

          try {
            if (target.type === "user") {
              await secretsManager.snapshotForUser(
                accessGrant.id,
                host.id,
                target.id as string,
                host.userId,
              );
            } else {
              await secretsManager.snapshotForRole(
                accessGrant.id,
                host.id,
                target.id as number,
                host.userId,
              );
            }
          } catch (snapshotError) {
            databaseLogger.warn("Share created but secret snapshot failed", {
              operation: "rbac_folder_share_snapshot_failed",
              hostId: host.id,
              accessId: accessGrant.id,
              error:
                snapshotError instanceof Error
                  ? snapshotError.message
                  : "Unknown error",
            });
          }
        }

        hostResults.push({ hostId: host.id, shared: true });
      }

      const sharedCount = hostResults.filter((r) => r.shared).length;

      databaseLogger.success("Folder shared successfully", {
        operation: "rbac_folder_share_success",
        userId,
        folder,
        hostsShared: sharedCount,
        targets: targets.length,
        permissionLevel,
      });

      res.json({
        success: true,
        message: "Folder shared successfully",
        permissionLevel,
        expiresAt,
        hostsShared: sharedCount,
        hostsTotal: hostsInFolder.length,
        hostResults,
      });
    } catch (error) {
      databaseLogger.error("Failed to share folder", error, {
        operation: "share_folder",
        folder,
        userId,
      });
      res.status(500).json({ error: "Failed to share folder" });
    }
  },
);

/**
 * @openapi
 * /rbac/host/{id}/access/{accessId}:
 *   patch:
 *     summary: Update a host access grant
 *     description: Changes the permission level and/or expiry of an existing host access grant. Allowed for the host owner or recipients holding the manage level.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: accessId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               permissionLevel:
 *                 type: string
 *                 enum: [connect, view, edit, manage]
 *               durationHours:
 *                 type: number
 *                 nullable: true
 *                 description: Hours from now until the grant expires; null clears the expiry.
 *     responses:
 *       200:
 *         description: Grant updated successfully.
 *       400:
 *         description: Invalid request.
 *       403:
 *         description: Caller may not manage sharing on this host.
 *       404:
 *         description: Grant not found.
 *       500:
 *         description: Failed to update grant.
 */
router.patch(
  "/host/:id/access/:accessId",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const accessIdParam = Array.isArray(req.params.accessId)
      ? req.params.accessId[0]
      : req.params.accessId;
    const hostId = parseInt(id, 10);
    const accessId = parseInt(accessIdParam, 10);
    const userId = req.userId!;

    if (isNaN(hostId) || isNaN(accessId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    try {
      const sharing = await canManageHostSharing(userId, hostId);
      if (!sharing.allowed) {
        return res
          .status(403)
          .json({ error: "You may not manage sharing on this host" });
      }

      const { permissionLevel, durationHours } = req.body ?? {};

      if (permissionLevel === undefined && durationHours === undefined) {
        return res.status(400).json({
          error: "At least one of permissionLevel or durationHours is required",
        });
      }

      if (
        permissionLevel !== undefined &&
        !isSharePermissionLevel(permissionLevel)
      ) {
        return res.status(400).json({
          error: "Invalid permission level",
          validLevels: SHARE_PERMISSION_LEVELS,
        });
      }

      const rbacAccessRepository = createCurrentRbacAccessRepository();
      const grant = await rbacAccessRepository.findHostAccessById(
        accessId,
        hostId,
      );
      if (!grant) {
        return res.status(404).json({ error: "Access grant not found" });
      }

      const update: { permissionLevel?: string; expiresAt?: string | null } =
        {};
      if (permissionLevel !== undefined) {
        update.permissionLevel = permissionLevel;
      }
      if (durationHours !== undefined) {
        update.expiresAt =
          durationHours === null ? null : expiryFromDuration(durationHours);
      }

      await rbacAccessRepository.updateHostAccessGrant(
        accessId,
        hostId,
        update,
      );

      databaseLogger.info("Host access grant updated", {
        operation: "rbac_host_access_update",
        userId,
        hostId,
        accessId,
        permissionLevel,
      });

      res.json({
        success: true,
        message: "Access updated",
        expiresAt: update.expiresAt ?? grant.expiresAt,
      });
    } catch (error) {
      databaseLogger.error("Failed to update host access", error, {
        operation: "update_host_access",
        hostId,
        accessId,
        userId,
      });
      res.status(500).json({ error: "Failed to update access" });
    }
  },
);

/**
 * @openapi
 * /rbac/host/{id}/access/{accessId}:
 *   delete:
 *     summary: Revoke host access
 *     description: Revokes a user's or role's access to a host.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: accessId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Access revoked successfully.
 *       400:
 *         description: Invalid ID.
 *       403:
 *         description: Caller may not manage sharing on this host.
 *       500:
 *         description: Failed to revoke access.
 */
router.delete(
  "/host/:id/access/:accessId",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const accessIdParam = Array.isArray(req.params.accessId)
      ? req.params.accessId[0]
      : req.params.accessId;
    const hostId = parseInt(id, 10);
    const accessId = parseInt(accessIdParam, 10);
    const userId = req.userId!;

    if (isNaN(hostId) || isNaN(accessId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    try {
      const sharing = await canManageHostSharing(userId, hostId);
      if (!sharing.allowed) {
        return res
          .status(403)
          .json({ error: "You may not manage sharing on this host" });
      }

      await createCurrentRbacAccessRepository().revokeHostAccess(
        accessId,
        hostId,
      );
      databaseLogger.info("Permission revoked", {
        operation: "rbac_permission_revoke",
        adminId: userId,
        hostId,
        accessId,
      });

      res.json({ success: true, message: "Access revoked" });
    } catch (error) {
      databaseLogger.error("Failed to revoke host access", error, {
        operation: "revoke_host_access",
        hostId,
        accessId,
        userId,
      });
      res.status(500).json({ error: "Failed to revoke access" });
    }
  },
);

/**
 * @openapi
 * /rbac/host/{id}/access:
 *   get:
 *     summary: Get host access list
 *     description: Retrieves the list of users and roles that have access to a host.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: The access list for the host, including each grant's permission level.
 *       400:
 *         description: Invalid host ID.
 *       403:
 *         description: Caller may not manage sharing on this host.
 *       500:
 *         description: Failed to get access list.
 */
router.get(
  "/host/:id/access",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const hostId = parseInt(id, 10);
    const userId = req.userId!;

    if (isNaN(hostId)) {
      return res.status(400).json({ error: "Invalid host ID" });
    }

    try {
      const sharing = await canManageHostSharing(userId, hostId);
      if (!sharing.allowed) {
        return res
          .status(403)
          .json({ error: "You may not manage sharing on this host" });
      }

      const accessList =
        await createCurrentRbacAccessRepository().listHostAccess(hostId);

      res.json({ accessList, isOwner: sharing.isOwner });
    } catch (error) {
      databaseLogger.error("Failed to get host access list", error, {
        operation: "get_host_access_list",
        hostId,
        userId,
      });
      res.status(500).json({ error: "Failed to get access list" });
    }
  },
);

/**
 * @openapi
 * /rbac/shared-hosts:
 *   get:
 *     summary: Get shared hosts
 *     description: Retrieves the list of hosts that have been shared with the authenticated user.
 *     tags:
 *       - RBAC
 *     responses:
 *       200:
 *         description: A list of shared hosts.
 *       500:
 *         description: Failed to get shared hosts.
 */
router.get(
  "/shared-hosts",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId!;

    try {
      const roleIds =
        await createCurrentRoleRepository().listUserRoleIds(userId);
      const sharedHosts =
        await createCurrentRbacAccessRepository().listSharedHosts(
          userId,
          roleIds,
        );

      res.json({ sharedHosts });
    } catch (error) {
      databaseLogger.error("Failed to get shared hosts", error, {
        operation: "get_shared_hosts",
        userId,
      });
      res.status(500).json({ error: "Failed to get shared hosts" });
    }
  },
);

/**
 * @openapi
 * /rbac/roles:
 *   get:
 *     summary: Get all roles
 *     description: Retrieves a list of all roles.
 *     tags:
 *       - RBAC
 *     responses:
 *       200:
 *         description: A list of roles.
 *       500:
 *         description: Failed to get roles.
 */
router.get(
  "/roles",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const rolesList = (await createCurrentRoleRepository().listRoles()).map(
        ({
          id,
          name,
          displayName,
          description,
          isSystem,
          permissions,
          createdAt,
          updatedAt,
        }) => {
          let parsedPermissions: string[] = [];
          try {
            parsedPermissions = permissions
              ? (JSON.parse(permissions) as string[])
              : [];
          } catch {
            parsedPermissions = [];
          }

          return {
            id,
            name,
            displayName,
            description,
            isSystem,
            permissions: parsedPermissions,
            createdAt,
            updatedAt,
          };
        },
      );

      res.json({ roles: rolesList });
    } catch (error) {
      databaseLogger.error("Failed to get roles", error, {
        operation: "get_roles",
      });
      res.status(500).json({ error: "Failed to get roles" });
    }
  },
);

/**
 * @openapi
 * /rbac/roles:
 *   post:
 *     summary: Create a new role
 *     description: Creates a new role.
 *     tags:
 *       - RBAC
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               displayName:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Role created successfully.
 *       400:
 *         description: Invalid request body.
 *       409:
 *         description: A role with this name already exists.
 *       500:
 *         description: Failed to create role.
 */
router.post(
  "/roles",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    const { name, displayName, description } = req.body;

    if (!isNonEmptyString(name) || !isNonEmptyString(displayName)) {
      return res.status(400).json({
        error: "Role name and display name are required",
      });
    }

    if (!/^[a-z0-9_-]+$/.test(name)) {
      return res.status(400).json({
        error:
          "Role name must contain only lowercase letters, numbers, underscores, and hyphens",
      });
    }

    try {
      const existing = await createCurrentRoleRepository().findRoleByName(name);

      if (existing) {
        return res.status(409).json({
          error: "A role with this name already exists",
        });
      }

      const newRoleId = await createCurrentRoleRepository().createRole({
        name,
        displayName,
        description: description || null,
        isSystem: false,
        permissions: null,
      });

      res.status(201).json({
        success: true,
        roleId: newRoleId,
        message: "Role created successfully",
      });
    } catch (error) {
      databaseLogger.error("Failed to create role", error, {
        operation: "create_role",
        roleName: name,
      });
      res.status(500).json({ error: "Failed to create role" });
    }
  },
);

/**
 * @openapi
 * /rbac/roles/{id}:
 *   put:
 *     summary: Update a role
 *     description: Updates a role by its ID.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *               description:
 *                 type: string
 *               permissions:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Permission strings validated against the permissions catalog (wildcards like hosts.* and * allowed).
 *     responses:
 *       200:
 *         description: Role updated successfully.
 *       400:
 *         description: Invalid request body or role ID.
 *       404:
 *         description: Role not found.
 *       500:
 *         description: Failed to update role.
 */
router.put(
  "/roles/:id",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const roleId = parseInt(id, 10);
    const { displayName, description, permissions } = req.body;

    if (isNaN(roleId)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }

    if (
      !displayName &&
      description === undefined &&
      permissions === undefined
    ) {
      return res.status(400).json({
        error:
          "At least one field (displayName, description or permissions) is required",
      });
    }

    if (permissions !== undefined) {
      if (
        !Array.isArray(permissions) ||
        permissions.some((perm) => typeof perm !== "string")
      ) {
        return res
          .status(400)
          .json({ error: "permissions must be an array of strings" });
      }

      const invalid = (permissions as string[]).filter(
        (perm) => !isValidPermission(perm),
      );
      if (invalid.length > 0) {
        return res.status(400).json({
          error: "Unknown permissions",
          invalid,
        });
      }
    }

    try {
      const roleRepository = createCurrentRoleRepository();
      const existingRole = await roleRepository.findRoleById(roleId);

      if (!existingRole) {
        return res.status(404).json({ error: "Role not found" });
      }

      const updates: {
        displayName?: string;
        description?: string | null;
        permissions?: string | null;
        updatedAt: string;
      } = {
        updatedAt: new Date().toISOString(),
      };

      if (displayName) {
        updates.displayName = displayName;
      }

      if (description !== undefined) {
        updates.description = description || null;
      }

      if (permissions !== undefined) {
        updates.permissions = JSON.stringify(permissions);
      }

      await roleRepository.updateRole(roleId, updates);

      if (permissions !== undefined) {
        const memberIds = await roleRepository.listRoleUserIds(roleId);
        for (const memberId of memberIds) {
          permissionManager.invalidateUserPermissionCache(memberId);
        }
      }

      res.json({
        success: true,
        message: "Role updated successfully",
      });
    } catch (error) {
      databaseLogger.error("Failed to update role", error, {
        operation: "update_role",
        roleId,
      });
      res.status(500).json({ error: "Failed to update role" });
    }
  },
);

/**
 * @openapi
 * /rbac/permissions/catalog:
 *   get:
 *     summary: Get the role permissions catalog
 *     description: Returns the grouped catalog of role permission strings used by the role permissions editor.
 *     tags:
 *       - RBAC
 *     responses:
 *       200:
 *         description: The permissions catalog.
 */
router.get(
  "/permissions/catalog",
  authenticateJWT,
  async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ catalog: PERMISSION_CATALOG });
  },
);

/**
 * @openapi
 * /rbac/roles/{id}:
 *   delete:
 *     summary: Delete a role
 *     description: Deletes a role by its ID.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Role deleted successfully.
 *       400:
 *         description: Invalid role ID.
 *       403:
 *         description: Cannot delete system roles.
 *       404:
 *         description: Role not found.
 *       500:
 *         description: Failed to delete role.
 */
router.delete(
  "/roles/:id",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const roleId = parseInt(id, 10);

    if (isNaN(roleId)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }

    try {
      const role = await createCurrentRoleRepository().findRoleById(roleId);

      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }

      if (role.isSystem) {
        return res.status(403).json({
          error: "Cannot delete system roles",
        });
      }

      const { deletedUserIds } =
        await createCurrentRoleRepository().deleteRole(roleId);

      for (const userId of deletedUserIds) {
        permissionManager.invalidateUserPermissionCache(userId);
      }

      res.json({
        success: true,
        message: "Role deleted successfully",
      });
    } catch (error) {
      databaseLogger.error("Failed to delete role", error, {
        operation: "delete_role",
        roleId,
      });
      res.status(500).json({ error: "Failed to delete role" });
    }
  },
);

/**
 * @openapi
 * /rbac/users/{userId}/roles:
 *   post:
 *     summary: Assign a role to a user
 *     description: Assigns a role to a user.
 *     tags:
 *       - RBAC
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
 *               roleId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Role assigned successfully.
 *       400:
 *         description: Role ID is required.
 *       403:
 *         description: System roles cannot be manually assigned.
 *       404:
 *         description: User or role not found.
 *       409:
 *         description: Role already assigned.
 *       500:
 *         description: Failed to assign role.
 */
router.post(
  "/users/:userId/roles",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    const targetUserId = Array.isArray(req.params.userId)
      ? req.params.userId[0]
      : req.params.userId;
    const currentUserId = req.userId!;

    try {
      const { roleId } = req.body;

      if (typeof roleId !== "number") {
        return res.status(400).json({ error: "Role ID is required" });
      }

      const targetUser =
        await createCurrentUserRepository().findById(targetUserId);

      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const role = await createCurrentRoleRepository().findRoleById(roleId);

      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }

      if (role.isSystem) {
        return res.status(403).json({
          error:
            "System roles (admin, user) are automatically assigned and cannot be manually assigned",
        });
      }

      const existing = await createCurrentRoleRepository().findUserRole(
        targetUserId,
        roleId,
      );

      if (existing) {
        return res.status(409).json({ error: "Role already assigned" });
      }

      await createCurrentRoleRepository().assignRoleToUser({
        userId: targetUserId,
        roleId,
        grantedBy: currentUserId,
      });

      try {
        const { SharedHostSecretsManager } =
          await import("../../utils/shared-host-secrets-manager.js");
        await SharedHostSecretsManager.getInstance().snapshotForRoleMember(
          roleId,
          targetUserId,
        );
      } catch (error) {
        databaseLogger.error(
          "Failed to snapshot shared host secrets for new role member",
          error,
          {
            operation: "assign_role_snapshot_secrets",
            targetUserId,
            roleId,
          },
        );
      }

      permissionManager.invalidateUserPermissionCache(targetUserId);
      databaseLogger.info("Role assigned to user", {
        operation: "rbac_role_assign",
        adminId: currentUserId,
        targetUserId,
        roleId,
        roleName: role.name,
      });

      res.json({
        success: true,
        message: "Role assigned successfully",
      });
    } catch (error) {
      databaseLogger.error("Failed to assign role", error, {
        operation: "assign_role",
        targetUserId,
      });
      res.status(500).json({ error: "Failed to assign role" });
    }
  },
);

/**
 * @openapi
 * /rbac/users/{userId}/roles/{roleId}:
 *   delete:
 *     summary: Remove a role from a user
 *     description: Removes a role from a user.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: roleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Role removed successfully.
 *       400:
 *         description: Invalid role ID.
 *       403:
 *         description: System roles cannot be removed.
 *       404:
 *         description: Role not found.
 *       500:
 *         description: Failed to remove role.
 */
router.delete(
  "/users/:userId/roles/:roleId",
  authenticateJWT,
  permissionManager.requireAdmin(),
  async (req: AuthenticatedRequest, res: Response) => {
    const targetUserId = Array.isArray(req.params.userId)
      ? req.params.userId[0]
      : req.params.userId;
    const roleIdParam = Array.isArray(req.params.roleId)
      ? req.params.roleId[0]
      : req.params.roleId;
    const roleId = parseInt(roleIdParam, 10);

    if (isNaN(roleId)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }

    try {
      const role = await createCurrentRoleRepository().findRoleById(roleId);

      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }

      if (role.isSystem) {
        return res.status(403).json({
          error:
            "System roles (admin, user) are automatically assigned and cannot be removed",
        });
      }

      await createCurrentRoleRepository().removeRoleFromUser(
        targetUserId,
        roleId,
      );

      try {
        const { createCurrentSharedHostSecretsRepository } =
          await import("../repositories/factory.js");
        await createCurrentSharedHostSecretsRepository().deleteForRoleMember(
          roleId,
          targetUserId,
        );
      } catch (cleanupError) {
        databaseLogger.warn(
          "Failed to clean shared host secrets after role removal",
          {
            operation: "remove_role_secret_cleanup",
            targetUserId,
            roleId,
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : "Unknown error",
          },
        );
      }

      permissionManager.invalidateUserPermissionCache(targetUserId);
      databaseLogger.info("Role removed from user", {
        operation: "rbac_role_remove",
        adminId: req.userId!,
        targetUserId,
        roleId,
      });

      res.json({
        success: true,
        message: "Role removed successfully",
      });
    } catch (error) {
      databaseLogger.error("Failed to remove role", error, {
        operation: "remove_role",
        targetUserId,
        roleId,
      });
      res.status(500).json({ error: "Failed to remove role" });
    }
  },
);

/**
 * @openapi
 * /rbac/users/{userId}/roles:
 *   get:
 *     summary: Get user's roles
 *     description: Retrieves a list of roles for a specific user.
 *     tags:
 *       - RBAC
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: A list of roles.
 *       403:
 *         description: Access denied.
 *       500:
 *         description: Failed to get user roles.
 */
router.get(
  "/users/:userId/roles",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const targetUserId = Array.isArray(req.params.userId)
      ? req.params.userId[0]
      : req.params.userId;
    const currentUserId = req.userId!;

    if (
      targetUserId !== currentUserId &&
      !(await permissionManager.isAdmin(currentUserId))
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    try {
      const userRolesList =
        await createCurrentRoleRepository().listUserRoles(targetUserId);

      res.json({ roles: userRolesList });
    } catch (error) {
      databaseLogger.error("Failed to get user roles", error, {
        operation: "get_user_roles",
        targetUserId,
      });
      res.status(500).json({ error: "Failed to get user roles" });
    }
  },
);

// SNIPPET SHARING

/**
 * @openapi
 * /rbac/snippet/{id}/share:
 *   post:
 *     summary: Share a snippet
 *     description: Shares a snippet with a user or role.
 *     tags:
 *       - RBAC
 */
router.post(
  "/snippet/:id/share",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const snippetId = parseInt(id, 10);
    const userId = req.userId!;

    if (isNaN(snippetId)) {
      return res.status(400).json({ error: "Invalid snippet ID" });
    }

    try {
      const {
        targetType = "user",
        targetUserId,
        targetRoleId,
        durationHours,
      } = req.body;

      if (!["user", "role"].includes(targetType)) {
        return res
          .status(400)
          .json({ error: "Invalid target type. Must be 'user' or 'role'" });
      }

      if (targetType === "user" && !isNonEmptyString(targetUserId)) {
        return res
          .status(400)
          .json({ error: "Target user ID is required when sharing with user" });
      }
      if (targetType === "role" && !targetRoleId) {
        return res
          .status(400)
          .json({ error: "Target role ID is required when sharing with role" });
      }

      const snippet = await createCurrentSnippetRepository().findOwnedById(
        userId,
        snippetId,
      );

      if (!snippet) {
        return res.status(403).json({ error: "Not snippet owner" });
      }

      if (targetType === "user") {
        const targetUser =
          await createCurrentUserRepository().findById(targetUserId);
        if (!targetUser) {
          return res.status(404).json({ error: "Target user not found" });
        }
      } else {
        const targetRole =
          await createCurrentRoleRepository().findRoleById(targetRoleId);
        if (!targetRole) {
          return res.status(404).json({ error: "Target role not found" });
        }
      }

      let expiresAt: string | null = null;
      if (
        durationHours &&
        typeof durationHours === "number" &&
        durationHours > 0
      ) {
        const expiryDate = new Date();
        expiryDate.setHours(expiryDate.getHours() + durationHours);
        expiresAt = expiryDate.toISOString();
      }

      const accessGrant =
        await createCurrentRbacAccessRepository().upsertSnippetAccess({
          snippetId,
          grantedBy: userId,
          expiresAt,
          ...(targetType === "user"
            ? { targetType: "user" as const, targetUserId: targetUserId! }
            : { targetType: "role" as const, targetRoleId: targetRoleId! }),
        });

      if (!accessGrant.created) {
        return res.json({
          success: true,
          message: "Snippet access updated",
          expiresAt,
        });
      }

      databaseLogger.success("Snippet shared successfully", {
        operation: "rbac_snippet_share",
        userId,
      });

      res.json({
        success: true,
        message: `Snippet shared successfully with ${targetType}`,
        expiresAt,
      });
    } catch (error) {
      databaseLogger.error("Failed to share snippet", error, {
        operation: "share_snippet",
        userId,
      });
      res.status(500).json({ error: "Failed to share snippet" });
    }
  },
);

/**
 * @openapi
 * /rbac/snippet/{id}/access/{accessId}:
 *   delete:
 *     summary: Revoke snippet access
 *     description: Revokes a user's or role's access to a snippet.
 *     tags:
 *       - RBAC
 */
router.delete(
  "/snippet/:id/access/:accessId",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const accessIdParam = Array.isArray(req.params.accessId)
      ? req.params.accessId[0]
      : req.params.accessId;
    const snippetId = parseInt(id, 10);
    const accessId = parseInt(accessIdParam, 10);
    const userId = req.userId!;

    if (isNaN(snippetId) || isNaN(accessId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    try {
      const snippet = await createCurrentSnippetRepository().findOwnedById(
        userId,
        snippetId,
      );

      if (!snippet) {
        return res.status(403).json({ error: "Not snippet owner" });
      }

      await createCurrentRbacAccessRepository().revokeSnippetAccess(
        accessId,
        snippetId,
      );

      res.json({ success: true, message: "Snippet access revoked" });
    } catch (error) {
      databaseLogger.error("Failed to revoke snippet access", error, {
        operation: "revoke_snippet_access",
        userId,
      });
      res.status(500).json({ error: "Failed to revoke access" });
    }
  },
);

/**
 * @openapi
 * /rbac/snippet/{id}/access:
 *   get:
 *     summary: Get snippet access list
 *     description: Retrieves the list of users and roles with access to a snippet.
 *     tags:
 *       - RBAC
 */
router.get(
  "/snippet/:id/access",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const snippetId = parseInt(id, 10);
    const userId = req.userId!;

    if (isNaN(snippetId)) {
      return res.status(400).json({ error: "Invalid snippet ID" });
    }

    try {
      const snippet = await createCurrentSnippetRepository().findOwnedById(
        userId,
        snippetId,
      );

      if (!snippet) {
        return res.status(403).json({ error: "Not snippet owner" });
      }

      const accessList =
        await createCurrentRbacAccessRepository().listSnippetAccess(snippetId);

      res.json({ accessList });
    } catch (error) {
      databaseLogger.error("Failed to get snippet access list", error, {
        operation: "get_snippet_access_list",
        userId,
      });
      res.status(500).json({ error: "Failed to get access list" });
    }
  },
);

/**
 * @openapi
 * /rbac/shared-snippets:
 *   get:
 *     summary: Get shared snippets
 *     description: Retrieves snippets shared with the current user.
 *     tags:
 *       - RBAC
 */
router.get(
  "/shared-snippets",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId!;

    try {
      const roleIds =
        await createCurrentRoleRepository().listUserRoleIds(userId);
      const sharedSnippets =
        await createCurrentRbacAccessRepository().listSharedSnippets(
          userId,
          roleIds,
        );

      res.json({ sharedSnippets });
    } catch (error) {
      databaseLogger.error("Failed to get shared snippets", error, {
        operation: "get_shared_snippets",
        userId,
      });
      res.status(500).json({ error: "Failed to get shared snippets" });
    }
  },
);

router.put(
  "/host-access/:hostId/credential",
  async (req: express.Request, res: express.Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId!;
      const hostId = Number.parseInt(String(req.params.hostId), 10);
      const { credentialId } = req.body;

      if (!hostId || isNaN(hostId)) {
        return res.status(400).json({ error: "Invalid host ID" });
      }

      const access =
        await createCurrentRbacAccessRepository().findDirectHostAccess(
          hostId,
          userId,
        );

      if (!access) {
        return res.status(403).json({ error: "No access to this host" });
      }

      if (credentialId) {
        const cred = await createCurrentCredentialRepository().findByIdForUser(
          userId,
          credentialId,
        );

        if (!cred) {
          return res.status(404).json({ error: "Credential not found" });
        }
      }

      await createCurrentRbacAccessRepository().updateHostAccessOverrideCredential(
        access.id,
        credentialId || null,
      );

      res.json({ success: true });
    } catch (error) {
      databaseLogger.error("Failed to set override credential", error);
      res.status(500).json({ error: "Failed to update credential" });
    }
  },
);

export default router;
