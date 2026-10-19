/**
 * Moves the audit forwarding collector URL and token out of the core settings
 * table into the audit-tools plugin's admin settings. The token is stored
 * encrypted with the installation key, like any plugin secret setting, and the
 * core copies are removed once the plugin has its own.
 *
 * Idempotent: a value the plugin already has is kept, and a core value is only
 * removed after the plugin holds a copy. Does nothing until the plugin row
 * exists (plugin_settings has a foreign key to plugins).
 */

import { databaseLogger } from "../utils/logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
  createCurrentSettingsRepository,
} from "../database/repositories/factory.js";
import { encryptSystemSecret } from "../utils/system-secret-crypto.js";

const PLUGIN_ID = "audit-tools";
const URL_SETTING = "audit_log_forward_url";
const TOKEN_SETTING = "audit_log_forward_token";

export interface AuditForwardingMigrationResult {
  url: boolean;
  token: boolean;
}

export async function runAuditForwardingMigration(): Promise<AuditForwardingMigrationResult> {
  const result: AuditForwardingMigrationResult = { url: false, token: false };

  try {
    if (!(await createCurrentPluginRepository().findById(PLUGIN_ID))) {
      return result;
    }
  } catch {
    return result;
  }

  const core = createCurrentSettingsRepository();
  const plugin = createCurrentPluginSettingsRepository();
  const legacyUrl = (await core.get(URL_SETTING))?.trim();
  const legacyToken = (await core.get(TOKEN_SETTING))?.trim();

  const has = async (key: string) => {
    const row = await plugin.get(PLUGIN_ID, "admin", null, key);
    return !!row && row.value !== null && row.value !== '""';
  };

  if (legacyUrl) {
    if (!(await has("url"))) {
      await plugin.set(
        PLUGIN_ID,
        "admin",
        null,
        "url",
        JSON.stringify(legacyUrl),
      );
      result.url = true;
    }
    if (legacyToken && !(await has("token"))) {
      await plugin.set(
        PLUGIN_ID,
        "admin",
        null,
        "token",
        JSON.stringify(await encryptSystemSecret(legacyToken)),
        true,
      );
      result.token = true;
    }
  }

  // Safe to drop now: the plugin holds the values, or never had a collector.
  if (legacyUrl ? await has("url") : true) {
    if (legacyUrl) await core.delete(URL_SETTING);
    if (legacyToken && (await has("token"))) await core.delete(TOKEN_SETTING);
    else if (!legacyUrl && legacyToken) await core.delete(TOKEN_SETTING);
  }

  if (result.url || result.token) {
    databaseLogger.info("Moved audit forwarding settings into audit-tools", {
      operation: "audit_forwarding_migration",
    });
  }
  return result;
}
