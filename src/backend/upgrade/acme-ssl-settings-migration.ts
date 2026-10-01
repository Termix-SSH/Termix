/**
 * Moves the 2.8 ACME configuration into the acme-ssl plugin.
 *
 * 2.8 kept it as one JSON row, `acme_ssl_settings`, in core settings. Each
 * field becomes a plugin admin setting. "manual" was never ACME (it meant an
 * uploaded certificate, which core still handles), so it turns renewal off.
 * The Cloudflare token was plaintext and lands as an encrypted secret; it is
 * then removed from the old row. The rest of the row stays for one release.
 *
 * Idempotent: a field already set in plugin_settings is never overwritten.
 */

import { databaseLogger } from "../utils/logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
  createCurrentSettingsRepository,
} from "../database/repositories/factory.js";
import { encryptSystemSecret } from "../utils/system-secret-crypto.js";

const PLUGIN_ID = "acme-ssl";
const LEGACY_KEY = "acme_ssl_settings";

export interface AcmeSslSettingsMigrationResult {
  moved: string[];
}

interface LegacyAcmeSettings {
  enabled?: unknown;
  domain?: unknown;
  email?: unknown;
  challengeType?: unknown;
  cloudflareToken?: unknown;
}

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export async function runAcmeSslSettingsMigration(): Promise<AcmeSslSettingsMigrationResult> {
  const result: AcmeSslSettingsMigrationResult = { moved: [] };

  try {
    const plugin = await createCurrentPluginRepository().findById(PLUGIN_ID);
    if (!plugin) return result;

    const settings = createCurrentSettingsRepository();
    const raw = await settings.get(LEGACY_KEY);
    if (!raw) return result;

    let legacy: LegacyAcmeSettings;
    try {
      legacy = JSON.parse(raw) as LegacyAcmeSettings;
    } catch {
      return result;
    }
    if (!legacy || typeof legacy !== "object") return result;

    const pluginSettings = createCurrentPluginSettingsRepository();
    const writeIfUnset = async (
      field: string,
      value: unknown,
      secret = false,
    ) => {
      const existing = await pluginSettings.get(
        PLUGIN_ID,
        "admin",
        null,
        field,
      );
      if (existing && existing.value !== null) return;
      await pluginSettings.set(
        PLUGIN_ID,
        "admin",
        null,
        field,
        JSON.stringify(value),
        secret,
      );
      result.moved.push(field);
    };

    const challenge = legacy.challengeType;
    const manual = challenge === "manual";

    const domain = text(legacy.domain);
    if (domain) await writeIfUnset("domain", domain);
    const email = text(legacy.email);
    if (email) await writeIfUnset("email", email);
    if (challenge === "dns-cloudflare") {
      await writeIfUnset("challengeType", "dns-cloudflare");
    } else if (challenge === "http-webroot") {
      await writeIfUnset("challengeType", "http-01");
    }
    if (typeof legacy.enabled === "boolean") {
      await writeIfUnset("autoRenew", legacy.enabled && !manual);
    }

    const token = text(legacy.cloudflareToken);
    if (token) {
      await writeIfUnset(
        "cloudflareToken",
        await encryptSystemSecret(token),
        true,
      );
      const { cloudflareToken: _dropped, ...rest } = legacy;
      await settings.set(LEGACY_KEY, JSON.stringify(rest));
    }

    if (result.moved.length > 0) {
      databaseLogger.info(
        `Moved ${result.moved.length} ACME setting(s) into plugin settings`,
        {
          operation: "acme_ssl_settings_migration",
          moved: result.moved.join(", "),
        },
      );
    }
  } catch (error) {
    // Must not stop the backend: the plugin then shows "not configured".
    databaseLogger.warn("ACME settings migration failed", {
      operation: "acme_ssl_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}
