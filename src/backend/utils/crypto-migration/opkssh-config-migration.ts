/**
 * Moves a 2.8 OPKSSH setup into the opkssh plugin.
 *
 * The config file moves from DATA_DIR/.opk/config.yml to the plugin's own
 * folder (DATA_DIR/plugins/opkssh/config.yml). The old file is copied, not
 * moved, so a downgrade still finds it. An install that had a config also
 * keeps sending the pre-2.9 redirect URI (/host/opkssh-callback), because
 * that is the one registered with its identity providers: the plugin's
 * legacyCallback admin setting is turned on.
 *
 * Idempotent: an existing target file or setting is never overwritten.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { databaseLogger } from "../logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
} from "../../database/repositories/factory.js";

const PLUGIN_ID = "opkssh";

export interface OpksshConfigMigrationResult {
  copied: boolean;
  legacyCallback: boolean;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function runOpksshConfigMigration(
  dataDir: string = process.env.DATA_DIR ||
    path.join(process.cwd(), "db", "data"),
): Promise<OpksshConfigMigrationResult> {
  const result: OpksshConfigMigrationResult = {
    copied: false,
    legacyCallback: false,
  };

  const legacyConfig = path.join(dataDir, ".opk", "config.yml");
  if (!(await exists(legacyConfig))) return result;

  try {
    const plugin = await createCurrentPluginRepository().findById(PLUGIN_ID);
    if (!plugin) return result;
  } catch {
    return result;
  }

  try {
    const target = path.join(dataDir, "plugins", PLUGIN_ID, "config.yml");
    if (!(await exists(target))) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(legacyConfig, target);
      result.copied = true;
    }

    const settings = createCurrentPluginSettingsRepository();
    const current = await settings.get(
      PLUGIN_ID,
      "admin",
      null,
      "legacyCallback",
    );
    if (!current) {
      await settings.set(
        PLUGIN_ID,
        "admin",
        null,
        "legacyCallback",
        JSON.stringify(true),
      );
      result.legacyCallback = true;
    }
  } catch (error) {
    databaseLogger.warn("OPKSSH config migration failed", {
      operation: "opkssh_config_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (result.copied) {
    databaseLogger.info("Copied the OPKSSH config into the opkssh plugin", {
      operation: "opkssh_config_migration",
    });
  }
  return result;
}
