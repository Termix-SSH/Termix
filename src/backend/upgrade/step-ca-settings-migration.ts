/**
 * Moves the 2.8 Step CA configuration into the step-ca plugin.
 *
 * The CA URL, root fingerprint, OIDC provisioner and private endpoint
 * allowlist lived in core `settings` rows. They become the plugin's admin
 * settings. An install that had a CA configured keeps sending the pre-2.9
 * redirect URI (/host/step-ca-callback), because that is the one registered
 * with its identity provider: the plugin's legacyCallback setting is turned
 * on.
 *
 * Idempotent: a value already present in plugin_settings is never
 * overwritten. The old rows stay for one release so a downgrade still works.
 */

import { databaseLogger } from "../utils/logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
  createCurrentSettingsRepository,
} from "../database/repositories/factory.js";
import { parseNotificationAllowlist } from "../utils/notification-egress.js";

const PLUGIN_ID = "step-ca";

const MOVES: { legacyKey: string; field: string }[] = [
  { legacyKey: "step_ca_url", field: "caUrl" },
  { legacyKey: "step_ca_fingerprint", field: "fingerprint" },
  { legacyKey: "step_ca_provisioner", field: "provisioner" },
];

const LEGACY_ALLOWLIST_KEY = "step_ca_private_endpoint_allowlist";

export interface StepCaSettingsMigrationResult {
  moved: string[];
  legacyCallback: boolean;
}

export async function runStepCaSettingsMigration(): Promise<StepCaSettingsMigrationResult> {
  const result: StepCaSettingsMigrationResult = {
    moved: [],
    legacyCallback: false,
  };

  try {
    // plugin_settings has a foreign key to plugins: nothing to move into yet.
    const plugin = await createCurrentPluginRepository().findById(PLUGIN_ID);
    if (!plugin) return result;

    const settings = createCurrentSettingsRepository();
    const pluginSettings = createCurrentPluginSettingsRepository();

    const writeIfUnset = async (field: string, value: unknown) => {
      const existing = await pluginSettings.get(
        PLUGIN_ID,
        "admin",
        null,
        field,
      );
      if (existing && existing.value !== null) return false;
      await pluginSettings.set(
        PLUGIN_ID,
        "admin",
        null,
        field,
        JSON.stringify(value),
      );
      return true;
    };

    for (const move of MOVES) {
      const value = (await settings.get(move.legacyKey))?.trim();
      if (!value) continue;
      if (await writeIfUnset(move.field, value)) {
        result.moved.push(move.legacyKey);
      }
    }

    const hosts = parseNotificationAllowlist(
      await settings.get(LEGACY_ALLOWLIST_KEY),
    );
    if (
      hosts.length > 0 &&
      (await writeIfUnset("privateEndpoints", hosts.join(", ")))
    ) {
      result.moved.push(LEGACY_ALLOWLIST_KEY);
    }

    if ((await settings.get("step_ca_url"))?.trim()) {
      result.legacyCallback = await writeIfUnset("legacyCallback", true);
    }

    if (result.moved.length > 0) {
      databaseLogger.info(
        `Moved ${result.moved.length} Step CA setting(s) into plugin settings`,
        {
          operation: "step_ca_settings_migration",
          moved: result.moved.join(", "),
        },
      );
    }
  } catch (error) {
    // Must not stop the backend: the plugin then reports "not configured".
    databaseLogger.warn("Step CA settings migration failed", {
      operation: "step_ca_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}
