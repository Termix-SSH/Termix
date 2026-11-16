/**
 * Finds or creates the user behind an external sign-in (OIDC, LDAP, a
 * plugin's provider). The rules used to be copied into every SSO route; they
 * live here once so every login method gets the same ones:
 *
 *   - the allowed-users list is checked on every sign-in, new user or not
 *   - the first user ever becomes admin and skips the list
 *   - anyone else is only created when SSO auto-provisioning is on
 *   - an admin group, when the provider reports one, keeps admin in step
 *   - a mapped role set, when the provider reports one, keeps roles in step
 */

import {
  DISABLED_REASON_PENDING,
  externalSignupApprovalRequired,
} from "./user-access-settings.js";
import { nanoid } from "nanoid";
import { authLogger } from "../utils/logger.js";
import { logAudit } from "../utils/audit-logger.js";
import { AuthManager } from "../utils/auth-manager.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { PermissionManager } from "../utils/permission-manager.js";
import { afterAdminStatusChange } from "./admin-status.js";
import {
  createCurrentRoleRepository,
  createCurrentSettingsRepository,
  createCurrentUserAuthRepository,
  createCurrentUserRepository,
} from "../database/repositories/factory.js";
import type { UserRecord } from "../database/repositories/user-repository.js";
import { isExternalUserAllowed } from "./allowed-users.js";
import { LoginMethodError, type VerifiedIdentity } from "./types.js";

type ExternalIdentity = Extract<VerifiedIdentity, { kind: "external" }>;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** The admin setting that turns external auto-provisioning on. */
export const EXTERNAL_AUTO_PROVISION_KEY = "external_auto_provision";

/** SSO auto-provisioning: the admin setting, or EXTERNAL_ALLOW_REGISTRATION. */
async function isExternalProvisioningAllowed(): Promise<boolean> {
  try {
    if (
      await createCurrentSettingsRepository().getBoolean(
        EXTERNAL_AUTO_PROVISION_KEY,
        false,
      )
    ) {
      return true;
    }
  } catch {
    // fall through to the environment
  }
  // OIDC_ALLOW_REGISTRATION is the 2.9 name, still read for one release.
  const allow =
    process.env.EXTERNAL_ALLOW_REGISTRATION ??
    process.env.OIDC_ALLOW_REGISTRATION ??
    "";
  return allow.trim().toLowerCase() === "true";
}

/** Whether a new external account has to wait for an admin first. */
function isApprovalRequired(): boolean {
  return externalSignupApprovalRequired();
}

function isAllowed(identity: ExternalIdentity): boolean {
  if (!identity.allowedUsers) return true;
  const email = identity.email ?? undefined;
  return (
    isExternalUserAllowed(identity.allowedUsers, identity.subject, email) ||
    (!!identity.legacyIdentifier &&
      isExternalUserAllowed(
        identity.allowedUsers,
        identity.legacyIdentifier,
        email,
      ))
  );
}

const SYSTEM_ROLE_NAMES = new Set(["admin", "user"]);

/**
 * Whether the provider says this user is an admin. An explicit admin claim
 * wins; otherwise a role map that manages "admin" decides.
 */
function adminFromIdentity(identity: ExternalIdentity): boolean | undefined {
  if (identity.isAdmin !== undefined) return identity.isAdmin;
  if (identity.roleSync?.managed.includes("admin")) {
    return identity.roleSync.desired.includes("admin");
  }
  return undefined;
}

export async function syncAdmin(
  user: UserRecord,
  isAdmin: boolean,
): Promise<UserRecord> {
  if (!!user.isAdmin === isAdmin) return user;
  const updated =
    (await createCurrentUserRepository().update(user.id, { isAdmin })) ?? user;
  try {
    await createCurrentRoleRepository().switchUserRoleName({
      userId: user.id,
      addRoleName: isAdmin ? "admin" : "user",
      removeRoleName: isAdmin ? "user" : "admin",
      grantedBy: user.id,
    });
  } catch {
    // Roles follow on the next sign-in; the admin flag itself is saved.
  }
  await afterAdminStatusChange(user.id, isAdmin);
  authLogger.info("Admin status synced from the identity provider", {
    operation: "external_admin_sync",
    userId: user.id,
    isAdmin,
  });
  return updated;
}

/**
 * Adds and removes the roles a provider's group map manages. Roles assigned
 * by hand, and roles outside the map, are never touched.
 */
export async function applyRoleSync(
  userId: string,
  roleSync: { desired: string[]; managed: string[] },
): Promise<void> {
  // System roles follow the admin flag, never the map directly.
  const desired = new Set(
    roleSync.desired.filter((name) => !SYSTEM_ROLE_NAMES.has(name)),
  );
  const managed = new Set(
    roleSync.managed.filter((name) => !SYSTEM_ROLE_NAMES.has(name)),
  );
  const roleRepository = createCurrentRoleRepository();
  const currentRoles = await roleRepository.listUserRoles(userId);
  const currentNames = new Set(currentRoles.map((role) => role.roleName));

  const toAdd = [...desired].filter((name) => !currentNames.has(name));
  const toRemove = currentRoles.filter(
    (role) => managed.has(role.roleName) && !desired.has(role.roleName),
  );

  for (const roleName of toAdd) {
    const assigned = await roleRepository.assignRoleNameToUser({
      userId,
      roleName,
      grantedBy: userId,
    });
    if (!assigned) {
      authLogger.warn("Role map references a role that does not exist", {
        operation: "external_role_map_missing_role",
        userId,
        roleName,
      });
    }
  }
  for (const role of toRemove) {
    await roleRepository.removeRoleFromUser(userId, role.roleId);
  }

  if (toAdd.length > 0 || toRemove.length > 0) {
    authLogger.info("Roles synced from provider group membership", {
      operation: "external_role_map_sync",
      userId,
      added: toAdd,
      removed: toRemove.map((role) => role.roleName),
    });
    PermissionManager.getInstance().invalidateUserPermissionCache(userId);
  }
}

/** Turns a new account off until an admin approves it, and says so. */
async function markPendingApproval(
  user: UserRecord,
  provider: string,
): Promise<UserRecord> {
  const updated =
    (await createCurrentUserRepository().update(user.id, {
      disabledAt: new Date().toISOString(),
      disabledReason: DISABLED_REASON_PENDING,
    })) ?? user;
  await logAudit({
    userId: user.id,
    username: user.username,
    action: "user_pending_approval",
    resourceType: "user",
    resourceId: user.id,
    resourceName: user.username,
    details: JSON.stringify({ provider }),
    success: true,
  });
  return updated;
}

async function findLinkedUser(
  identity: ExternalIdentity,
): Promise<UserRecord | null> {
  const linked = await createCurrentUserAuthRepository().findIdentity(
    identity.provider,
    identity.subject,
  );
  if (!linked) return null;
  return createCurrentUserRepository().findById(linked.userId);
}

/**
 * The first external sign in of someone a provisioning plugin made an account
 * for: the account is matched on the provider's verified email and the sign
 * in is linked to it. Only accounts a plugin made, with no password and no
 * linked sign in yet, are matched, so no existing account can be taken over.
 */
async function claimManagedAccount(
  identity: ExternalIdentity,
): Promise<UserRecord | null> {
  const email = identity.email?.trim().toLowerCase();
  if (!email) return null;
  const user = await createCurrentUserRepository().findByEmail(email);
  if (!user?.managedBy || (user.passwordHash ?? "").trim() !== "") return null;
  const auth = createCurrentUserAuthRepository();
  if ((await auth.listIdentitiesForUser(user.id)).length > 0) return null;

  await auth.linkIdentity({
    userId: user.id,
    providerId: identity.provider,
    subject: identity.subject,
    email,
  });
  await logAudit({
    userId: user.id,
    username: user.username,
    action: "link_external_identity",
    resourceType: "user",
    resourceId: user.id,
    resourceName: user.username,
    details: JSON.stringify({
      provider: identity.provider,
      managedBy: user.managedBy,
      matchedOn: "email",
    }),
    success: true,
  });
  authLogger.info("Linked a first sign in to a provisioned account", {
    operation: "external_managed_account_claimed",
    userId: user.id,
    provider: identity.provider,
  });
  return user;
}

/**
 * Makes an account for a provisioning plugin, with no password and no
 * session: the user role, a data key and the plugin as its manager. The
 * username and email must be free.
 */
export async function provisionManagedAccount(input: {
  managedBy: string;
  username: string;
  displayName?: string | null;
  email?: string | null;
}): Promise<UserRecord> {
  const users = createCurrentUserRepository();
  const id = nanoid();
  const user = await users.create({
    id,
    username: input.username,
    passwordHash: "",
    isAdmin: false,
    displayName: input.displayName ?? null,
    email: input.email ?? null,
    managedBy: input.managedBy,
  });
  try {
    await createCurrentRoleRepository().assignRoleNameToUser({
      userId: id,
      roleName: "user",
      grantedBy: id,
    });
    await AuthManager.getInstance().registerExternalUser(id);
  } catch (error) {
    await users.delete(id);
    throw error;
  }
  await DatabaseSaveTrigger.forceSave("managed_user_create").catch(() => {});
  return user;
}

/**
 * A username nobody else has. An identity provider's display name must never
 * give an SSO account the same username as a local one, such as "admin".
 */
async function freeUsername(
  wanted: string,
  selfId: string | null,
): Promise<string> {
  const users = createCurrentUserRepository();
  let candidate = wanted;
  for (let attempt = 0; attempt < 5; attempt++) {
    const holder = await users.findByUsername(candidate);
    if (!holder || holder.id === selfId) return candidate;
    candidate = `${wanted}-${nanoid(4)}`;
  }
  return `${wanted}-${nanoid(10)}`;
}

async function createUser(
  identity: ExternalIdentity,
  deviceType: string,
): Promise<UserRecord> {
  const users = createCurrentUserRepository();
  const id = nanoid();
  const created = await users.createFirstSsoUser({
    id,
    username: await freeUsername(identity.name || identity.subject, null),
    passwordHash: "",
    isAdmin: !!adminFromIdentity(identity),
  });

  try {
    const assigned = await createCurrentRoleRepository().assignRoleNameToUser({
      userId: id,
      roleName: created.user.isAdmin ? "admin" : "user",
      grantedBy: id,
    });
    if (!assigned) {
      authLogger.warn("Default role not found for a provisioned user", {
        operation: "external_default_role",
        userId: id,
      });
    }
  } catch (roleError) {
    authLogger.error("Failed to assign a default role", roleError, {
      operation: "external_default_role",
      userId: id,
    });
  }

  try {
    const sessionDurationMs =
      deviceType === "desktop" || deviceType === "mobile"
        ? THIRTY_DAYS_MS
        : ONE_DAY_MS;
    await AuthManager.getInstance().registerExternalUser(id, sessionDurationMs);
  } catch (encryptionError) {
    await users.delete(id);
    authLogger.error(
      "Failed to set up a provisioned user's encryption, user removed",
      encryptionError,
      { operation: "external_user_create_failed", userId: id },
    );
    throw new LoginMethodError(
      "Failed to setup user security - user creation cancelled",
      500,
      "setup_failed",
    );
  }

  await createCurrentUserAuthRepository().linkIdentity({
    userId: id,
    providerId: identity.provider,
    subject: identity.subject,
    email: identity.email,
  });

  try {
    await DatabaseSaveTrigger.forceSave("external_user_create");
  } catch (saveError) {
    authLogger.error("Failed to persist a provisioned user", saveError, {
      operation: "external_user_create_save_failed",
      userId: id,
    });
  }

  return created.user;
}

export async function findOrProvisionExternalUser(
  identity: ExternalIdentity,
  deviceType: string,
): Promise<UserRecord> {
  let user =
    (await findLinkedUser(identity)) ?? (await claimManagedAccount(identity));

  if (!user) {
    const isFirstUser = (await createCurrentUserRepository().countAll()) === 0;
    if (!isFirstUser) {
      if (!isAllowed(identity)) {
        authLogger.warn("External user not in the allowed list", {
          operation: "external_user_not_allowed",
          provider: identity.provider,
        });
        throw new LoginMethodError("User not allowed", 403, "user_not_allowed");
      }
      if (!(await isExternalProvisioningAllowed())) {
        authLogger.warn("External sign-in refused, provisioning is off", {
          operation: "external_registration_disabled",
          provider: identity.provider,
        });
        throw new LoginMethodError(
          "You have no Termix account yet. Ask an admin to turn on Auto-create external accounts.",
          403,
          "registration_disabled",
        );
      }
    }
    user = await createUser(identity, deviceType);
    if (!isFirstUser && isApprovalRequired()) {
      user = await markPendingApproval(user, identity.provider);
    }
  } else {
    if (!isAllowed(identity)) {
      authLogger.warn("External user not in the allowed list", {
        operation: "external_user_not_allowed_existing",
        provider: identity.provider,
        userId: user.id,
      });
      throw new LoginMethodError("User not allowed", 403, "user_not_allowed");
    }

    // A user who also has a password picked their own username; leave it.
    // A provisioning plugin owns the username of an account it made.
    const isDualAuth = !!user.passwordHash && user.passwordHash.trim() !== "";
    if (
      !isDualAuth &&
      !user.managedBy &&
      identity.name &&
      user.username !== identity.name
    ) {
      // Taken by someone else: keep the name the account already has.
      const holder = await createCurrentUserRepository().findByUsername(
        identity.name,
      );
      if (!holder || holder.id === user.id) {
        user =
          (await createCurrentUserRepository().update(user.id, {
            username: identity.name,
          })) ?? user;
      }
    }

    const wantsAdmin = adminFromIdentity(identity);
    if (wantsAdmin !== undefined) {
      user = await syncAdmin(user, wantsAdmin);
    }
  }

  if (identity.roleSync) {
    try {
      await applyRoleSync(user.id, identity.roleSync);
    } catch (roleSyncError) {
      authLogger.error("Failed to sync roles from provider", roleSyncError, {
        operation: "external_role_map_sync_failed",
        userId: user.id,
      });
    }
  }

  return user;
}
