/**
 * Moves the silent sign-in default out of core settings and into the sso
 * plugin's admin settings. Core used to own the toggle and read it on the
 * login page; the sso plugin now marks its own login instance to start on
 * its own.
 *
 * Idempotent: a value already in plugin settings wins and the core copy is
 * dropped.
 */

import { databaseLogger } from "../utils/logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
  createCurrentSettingsRepository,
} from "../database/repositories/factory.js";

const PLUGIN_ID = "sso";
const LEGACY_KEY = "oidc_silent_login_default";
const FIELD = "silentLoginDefault";

export interface SsoSettingsMigrationResult {
  moved: boolean;
}

export async function runSsoSettingsMigration(): Promise<SsoSettingsMigrationResult> {
  try {
    const plugin = await createCurrentPluginRepository().findById(PLUGIN_ID);
    if (!plugin) return { moved: false };

    const settings = createCurrentSettingsRepository();
    const legacy = await settings.get(LEGACY_KEY);
    if (legacy === null || legacy === "") return { moved: false };

    const pluginSettings = createCurrentPluginSettingsRepository();
    const existing = await pluginSettings.get(PLUGIN_ID, "admin", null, FIELD);
    if (!existing || existing.value === null) {
      await pluginSettings.set(
        PLUGIN_ID,
        "admin",
        null,
        FIELD,
        JSON.stringify(legacy === "true"),
        false,
      );
    }
    await settings.delete(LEGACY_KEY);
    databaseLogger.info("Moved the silent sign-in default into sso settings", {
      operation: "sso_settings_migration",
    });
    return { moved: true };
  } catch (error) {
    databaseLogger.warn("SSO settings migration failed", {
      operation: "sso_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
    return { moved: false };
  }
}
