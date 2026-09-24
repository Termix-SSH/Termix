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

import { nanoid } from "nanoid";
import { authLogger } from "../utils/logger.js";
import { AuthManager } from "../utils/auth-manager.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { PermissionManager } from "../utils/permission-manager.js";
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

/** SSO auto-provisioning: the admin setting, or OIDC_ALLOW_REGISTRATION. */
export async function isExternalProvisioningAllowed(): Promise<boolean> {
  try {
    if (
      await createCurrentSettingsRepository().getBoolean(
        "oidc_auto_provision",
        false,
      )
    ) {
      return true;
    }
  } catch {
    // fall through to the environment
  }
  return (
    (process.env.OIDC_ALLOW_REGISTRATION || "").trim().toLowerCase() === "true"
  );
}

/**
 * Whether a newly provisioned user must wait for an admin. There is no
 * approval queue yet, so nobody does; a plugin or a later release can change
 * that here without touching any login method.
 */
export async function isApprovalRequired(
  _identity: ExternalIdentity,
): Promise<boolean> {
  return false;
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

async function syncAdmin(
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
  const desired = new Set(roleSync.desired);
  const managed = new Set(roleSync.managed);
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

async function findLinkedUser(
  identity: ExternalIdentity,
): Promise<UserRecord | null> {
  const identities = createCurrentUserAuthRepository();
  const users = createCurrentUserRepository();

  const linked = await identities.findIdentity(
    identity.provider,
    identity.subject,
  );
  if (linked) {
    const user = await users.findById(linked.userId);
    if (user) return user;
  }

  // Accounts from before user_external_identities matched on the raw
  // identifier column; link them the first time they sign in.
  if (identity.legacyIdentifier) {
    const legacy = await users.findByOidcIdentifier(identity.legacyIdentifier);
    if (legacy) {
      await identities.linkIdentity({
        userId: legacy.id,
        providerId: identity.provider,
        subject: identity.subject,
        email: identity.email,
      });
      return legacy;
    }
  }
  return null;
}

async function createUser(
  identity: ExternalIdentity,
  deviceType: string,
): Promise<UserRecord> {
  const users = createCurrentUserRepository();
  const id = nanoid();
  const created = await users.createFirstSsoUser({
    id,
    username: identity.name || identity.subject,
    passwordHash: "",
    isAdmin: !!identity.isAdmin,
    isOidc: true,
    oidcIdentifier:
      identity.legacyIdentifier ?? `${identity.provider}:${identity.subject}`,
    ssoProviderId: identity.ssoProviderId ?? null,
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
    await AuthManager.getInstance().registerOIDCUser(id, sessionDurationMs);
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
  let user = await findLinkedUser(identity);

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
          "Registration is disabled",
          403,
          "registration_disabled",
        );
      }
      if (await isApprovalRequired(identity)) {
        throw new LoginMethodError(
          "Your account is waiting for an admin to approve it",
          403,
          "approval_required",
        );
      }
    }
    user = await createUser(identity, deviceType);
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
    const isDualAuth = !!user.passwordHash && user.passwordHash.trim() !== "";
    if (!isDualAuth && identity.name && user.username !== identity.name) {
      user =
        (await createCurrentUserRepository().update(user.id, {
          username: identity.name,
        })) ?? user;
    }

    if (identity.isAdmin !== undefined) {
      user = await syncAdmin(user, identity.isAdmin);
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
