/**
 * Renames the auto-provision setting from its 2.8 name, oidc_auto_provision,
 * to external_auto_provision: it covers every external login, not only OIDC.
 *
 * Idempotent: a value already under the new key wins and the old row is
 * dropped.
 */

import { databaseLogger } from "../utils/logger.js";
import { createCurrentSettingsRepository } from "../database/repositories/factory.js";
import { EXTERNAL_AUTO_PROVISION_KEY } from "../auth/provisioning.js";
const LEGACY_KEY = "oidc_auto_provision";

export async function runExternalAutoProvisionMigration(): Promise<boolean> {
  try {
    const settings = createCurrentSettingsRepository();
    const legacy = await settings.get(LEGACY_KEY);
    if (legacy === null) return false;
    if ((await settings.get(EXTERNAL_AUTO_PROVISION_KEY)) === null) {
      await settings.set(EXTERNAL_AUTO_PROVISION_KEY, legacy);
    }
    await settings.delete(LEGACY_KEY);
    return true;
  } catch (error) {
    databaseLogger.warn("Auto-provision setting rename failed", {
      operation: "external_auto_provision_migration",
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
