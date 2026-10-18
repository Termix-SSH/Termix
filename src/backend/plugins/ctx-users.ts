/**
 * ctx.users, and ctx.auth.issueUserToken: what a plugin may learn about a
 * user, and a short-lived session for calling core's own API as one.
 */

import type {
  PluginUserToken,
  PluginUserTokenOptions,
  PluginUsers,
} from "@termix-ssh/plugin-sdk/backend";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import { assertCapability } from "./permissions.js";
import { getActor } from "./actor.js";

const DEFAULT_TOKEN_TTL_SECONDS = 300;
const MAX_TOKEN_TTL_SECONDS = 900;
const MAX_PURPOSE_LENGTH = 200;

export function createPluginUsers(manifest: PluginManifest): PluginUsers {
  return {
    getLocale: async (userId) => {
      await assertCapability(
        manifest.id,
        "users:read",
        manifest.capabilities,
        "users_get_locale",
      );
      const { createCurrentUserPreferenceRepository } =
        await import("../database/repositories/factory.js");
      const preferences =
        await createCurrentUserPreferenceRepository().findByUserId(userId);
      return preferences?.language ?? null;
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
