/**
 * ctx.users, and ctx.auth.issueUserToken: what a plugin may learn about a
 * user, and a short-lived session for calling core's own API as one.
 */

import type {
  PluginManagedUser,
  PluginUserToken,
  PluginUserTokenOptions,
  PluginUsers,
} from "@termix-ssh/plugin-sdk/backend";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import type { UserRecord } from "../database/repositories/user-repository.js";
import { assertCapability } from "./permissions.js";
import { getActor } from "./actor.js";

const DEFAULT_TOKEN_TTL_SECONDS = 300;
const MAX_TOKEN_TTL_SECONDS = 900;
const MAX_PURPOSE_LENGTH = 200;
const USERNAME_MAX = 255;
const SYSTEM_ROLES = new Set(["admin", "user"]);

function view(user: UserRecord): PluginManagedUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? null,
    email: user.email ?? null,
    isAdmin: !!user.isAdmin,
    disabled: !!user.disabledAt,
    disabledReason: user.disabledReason ?? null,
    managedBy: user.managedBy ?? null,
  };
}

const repositories = () => import("../database/repositories/factory.js");
const lifecycle = () => import("../auth/account-lifecycle.js");
const provisioning = () => import("../auth/provisioning.js");

async function refuse(
  message: string,
  code:
    "not_found" | "last_admin" | "username_taken" | "email_taken" | "invalid",
): Promise<never> {
  const { AccountError } = await lifecycle();
  throw new AccountError(message, code);
}

/** A display name and email checked the way the profile routes check them. */
async function checkedProfile(input: {
  displayName?: string | null;
  email?: string | null;
}): Promise<{ displayName?: string | null; email?: string | null }> {
  if (input.displayName === undefined && input.email === undefined) return {};
  const { readProfileInput } = await import("../auth/profile-input.js");
  const read = readProfileInput(input);
  if ("error" in read) return refuse(read.error, "invalid");
  return read.update;
}

async function checkedUsername(username: unknown): Promise<string> {
  const name = typeof username === "string" ? username.trim() : "";
  if (!name || name.length > USERNAME_MAX) {
    return refuse("Username is empty or too long", "invalid");
  }
  return name;
}

function plainRoles(names: unknown): string[] {
  return (Array.isArray(names) ? names : []).filter(
    (name): name is string =>
      typeof name === "string" && !SYSTEM_ROLES.has(name),
  );
}

export function createPluginUsers(
  manifest: PluginManifest,
): Required<PluginUsers> {
  const read = (operation: string) =>
    assertCapability(
      manifest.id,
      "users:read",
      manifest.capabilities,
      operation,
    );
  const write = (operation: string) =>
    assertCapability(
      manifest.id,
      "users:write",
      manifest.capabilities,
      operation,
    );

  async function audit(
    action: string,
    user: { id: string; username: string },
    details: Record<string, unknown> = {},
  ) {
    const { logAudit } = await import("../utils/audit-logger.js");
    await logAudit({
      userId: getActor() ?? null,
      username: `plugin:${manifest.id}`,
      action,
      resourceType: "user",
      resourceId: user.id,
      resourceName: user.username,
      details: JSON.stringify({ pluginId: manifest.id, ...details }),
      success: true,
    });
  }

  async function target(userId: string): Promise<UserRecord> {
    const { createCurrentUserRepository } = await repositories();
    const user = userId
      ? await createCurrentUserRepository().findById(userId)
      : null;
    return user ?? refuse(`User "${userId}" does not exist`, "not_found");
  }

  async function assertFree(
    selfId: string | null,
    username?: string,
    email?: string | null,
  ) {
    const { createCurrentUserRepository } = await repositories();
    const users = createCurrentUserRepository();
    if (username !== undefined) {
      const holder = await users.findByUsername(username);
      if (holder && holder.id !== selfId) {
        await refuse("That username is taken", "username_taken");
      }
    }
    if (email) {
      const holder = await users.findByEmail(email);
      if (holder && holder.id !== selfId) {
        await refuse("That email is already in use", "email_taken");
      }
    }
  }

  async function lastAdminGuard(user: UserRecord, message: string) {
    if (!user.isAdmin || user.disabledAt) return;
    const { createCurrentUserRepository } = await repositories();
    if ((await createCurrentUserRepository().countAdmins()) <= 1) {
      await refuse(message, "last_admin");
    }
  }

  return {
    getLocale: async (userId) => {
      await read("users_get_locale");
      const { createCurrentUserPreferenceRepository } = await repositories();
      const preferences =
        await createCurrentUserPreferenceRepository().findByUserId(userId);
      return preferences?.language ?? null;
    },

    get: async (userId) => {
      await read("users_get");
      const { createCurrentUserRepository } = await repositories();
      const user = await createCurrentUserRepository().findById(userId);
      return user ? view(user) : null;
    },

    findByUsername: async (username) => {
      await read("users_find");
      const { createCurrentUserRepository } = await repositories();
      const user = await createCurrentUserRepository().findByUsername(
        String(username ?? ""),
      );
      return user ? view(user) : null;
    },

    findByEmail: async (email) => {
      await read("users_find");
      const { createCurrentUserRepository } = await repositories();
      const user = await createCurrentUserRepository().findByEmail(
        String(email ?? ""),
      );
      return user ? view(user) : null;
    },

    listRoles: async () => {
      await read("users_list_roles");
      const { createCurrentRoleRepository } = await repositories();
      return (await createCurrentRoleRepository().listRoles()).map((role) => ({
        name: role.name,
        displayName: role.displayName,
        isSystem: !!role.isSystem,
      }));
    },

    create: async (input) => {
      await write("users_create");
      const username = await checkedUsername(input?.username);
      const profile = await checkedProfile({
        displayName: input?.displayName ?? undefined,
        email: input?.email ?? undefined,
      });
      await assertFree(null, username, profile.email);
      const { provisionManagedAccount } = await provisioning();
      const { isUsernameTaken } =
        await import("../database/repositories/user-repository.js");
      let user: UserRecord;
      try {
        user = await provisionManagedAccount({
          managedBy: manifest.id,
          username,
          displayName: profile.displayName ?? null,
          email: profile.email ?? null,
        });
      } catch (error) {
        if (isUsernameTaken(error)) {
          return refuse("That username or email is taken", "username_taken");
        }
        throw error;
      }
      await audit("plugin_user_create", user);
      return view(user);
    },

    update: async (userId, input) => {
      await write("users_update");
      const user = await target(userId);
      const change: {
        username?: string;
        displayName?: string | null;
        email?: string | null;
      } = await checkedProfile({
        displayName: input?.displayName,
        email: input?.email,
      });
      if (input?.username !== undefined) {
        change.username = await checkedUsername(input.username);
      }
      if (Object.keys(change).length === 0) return view(user);
      await assertFree(user.id, change.username, change.email);
      const { createCurrentUserRepository } = await repositories();
      const saved =
        (await createCurrentUserRepository().update(user.id, change)) ?? user;
      await audit("plugin_user_update", saved, {
        fields: Object.keys(change),
      });
      return view(saved);
    },

    setDisabled: async (userId, disabled, reason) => {
      await write("users_set_disabled");
      const user = await target(userId);
      const { disableAccount, enableAccount } = await lifecycle();
      const why = String(reason || manifest.id).slice(0, 64);
      const changed = disabled
        ? await disableAccount(user, why)
        : await enableAccount(user);
      if (changed) {
        await audit(
          disabled ? "plugin_user_disable" : "plugin_user_enable",
          user,
          { reason: why },
        );
      }
    },

    delete: async (userId, options) => {
      await write("users_delete");
      const user = await target(userId);
      await lastAdminGuard(user, "Cannot delete the last admin");
      const successorUserId = options?.successorUserId || undefined;
      if (successorUserId) await target(successorUserId);
      const { deleteUserAndRelatedData } =
        await import("../database/routes/delete-user-data.js");
      await deleteUserAndRelatedData(user.id, { successorUserId });
      await audit("plugin_user_delete", user, {
        successorUserId: successorUserId ?? null,
      });
    },

    syncRoles: async (userId, roles) => {
      await write("users_sync_roles");
      const user = await target(userId);
      const desired = plainRoles(roles?.desired);
      const { applyRoleSync } = await provisioning();
      await applyRoleSync(user.id, {
        desired,
        managed: plainRoles(roles?.managed),
      });
      await audit("plugin_user_roles", user, { desired });
    },

    setAdmin: async (userId, isAdmin) => {
      await write("users_set_admin");
      const user = await target(userId);
      if (!!user.isAdmin === !!isAdmin) return;
      if (!isAdmin) await lastAdminGuard(user, "Cannot remove the last admin");
      const { syncAdmin } = await provisioning();
      await syncAdmin(user, !!isAdmin);
      await audit(isAdmin ? "plugin_make_admin" : "plugin_remove_admin", user);
    },
  };
}

export async function issueUserToken(
  manifest: PluginManifest,
  userId: string,
  options: PluginUserTokenOptions,
): Promise<PluginUserToken> {
  await assertCapability(
    manifest.id,
    "users:impersonate",
    manifest.capabilities,
    "user_token_issued",
  );
  const { logAudit } = await import("../utils/audit-logger.js");
  const purpose = String(options?.purpose ?? "")
    .trim()
    .slice(0, MAX_PURPOSE_LENGTH);
  const ttlSeconds = Math.min(
    options?.ttlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS,
    MAX_TOKEN_TTL_SECONDS,
  );
  const audit = (success: boolean, errorMessage?: string) =>
    logAudit({
      userId: getActor() ?? null,
      username: `plugin:${manifest.id}`,
      action: "plugin_user_token_issued",
      resourceType: "user",
      resourceId: userId,
      details: JSON.stringify({ pluginId: manifest.id, purpose, ttlSeconds }),
      success,
      errorMessage,
    });

  try {
    if (!purpose) {
      throw new Error("ctx.auth.issueUserToken needs a purpose");
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error("ttlSeconds must be a positive whole number");
    }
    const { createCurrentUserRepository } =
      await import("../database/repositories/factory.js");
    const user = userId
      ? await createCurrentUserRepository().findById(userId)
      : null;
    if (!user) throw new Error(`User "${userId}" does not exist`);

    const { AuthManager } = await import("../utils/auth-manager.js");
    const issued = await AuthManager.getInstance().issuePluginSession(user.id, {
      pluginId: manifest.id,
      purpose,
      ttlSeconds,
    });
    await audit(true);
    return issued;
  } catch (error) {
    await audit(false, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
