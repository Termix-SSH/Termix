/**
 * Boot copies of 2.8 data into plugin settings and plugin tables.
 *
 * They run after the plugins are seeded and activated: plugin_settings has a
 * foreign key to plugins, and some copies write into tables a plugin adopts
 * in its own migrations. Each one is idempotent, so they also run again when
 * an admin enables a plugin without a restart.
 */

import { databaseLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-message.js";
import { runTailscaleSettingsMigration } from "../utils/crypto-migration/tailscale-settings-migration.js";
import { runProxmoxSettingsMigration } from "../utils/crypto-migration/proxmox-settings-migration.js";
import { runFileManagerSettingsMigration } from "../utils/crypto-migration/file-manager-settings-migration.js";
import { runTunnelsSettingsMigration } from "../utils/crypto-migration/tunnels-settings-migration.js";
import { runWebEndpointSettingsMigration } from "../utils/crypto-migration/web-endpoint-settings-migration.js";
import { runSshTerminalSettingsMigration } from "../utils/crypto-migration/ssh-terminal-settings-migration.js";
import { runTmuxMonitorSettingsMigration } from "../utils/crypto-migration/tmux-monitor-settings-migration.js";
import { runSessionSharingSettingsMigration } from "../utils/crypto-migration/session-sharing-settings-migration.js";
import { runSessionRecordingSettingsMigration } from "../utils/crypto-migration/session-recording-settings-migration.js";
import { runRemoteDesktopSettingsMigration } from "../utils/crypto-migration/remote-desktop-settings-migration.js";
import { runHostMetricsSettingsMigration } from "../utils/crypto-migration/host-metrics-settings-migration.js";
import { runDockerSettingsMigration } from "../utils/crypto-migration/docker-settings-migration.js";
import { runAiSettingsMigration } from "../utils/crypto-migration/ai-settings-migration.js";
import { runWakeOnLanSettingsMigration } from "../utils/crypto-migration/wake-on-lan-settings-migration.js";
import { runWarpgateSettingsMigration } from "../utils/crypto-migration/warpgate-settings-migration.js";
import { runStepCaSettingsMigration } from "../utils/crypto-migration/step-ca-settings-migration.js";
import { runAcmeSslSettingsMigration } from "../utils/crypto-migration/acme-ssl-settings-migration.js";
import { runVaultSettingsMigration } from "../utils/crypto-migration/vault-settings-migration.js";
import { runSecretSourcesTokenMigration } from "../utils/crypto-migration/secret-sources-token-migration.js";
import { runTotpMigration } from "../utils/crypto-migration/totp-migration.js";
import { runTermixIdentityCaMigration } from "../utils/crypto-migration/termix-identity-ca-migration.js";

const MIGRATIONS: Array<[string, () => Promise<unknown>]> = [
  ["runTailscaleSettingsMigration", runTailscaleSettingsMigration],
  ["runProxmoxSettingsMigration", runProxmoxSettingsMigration],
  ["runFileManagerSettingsMigration", runFileManagerSettingsMigration],
  ["runTunnelsSettingsMigration", runTunnelsSettingsMigration],
  ["runWebEndpointSettingsMigration", runWebEndpointSettingsMigration],
  ["runSshTerminalSettingsMigration", runSshTerminalSettingsMigration],
  ["runTmuxMonitorSettingsMigration", runTmuxMonitorSettingsMigration],
  ["runSessionSharingSettingsMigration", runSessionSharingSettingsMigration],
  [
    "runSessionRecordingSettingsMigration",
    runSessionRecordingSettingsMigration,
  ],
  ["runRemoteDesktopSettingsMigration", runRemoteDesktopSettingsMigration],
  ["runHostMetricsSettingsMigration", runHostMetricsSettingsMigration],
  ["runDockerSettingsMigration", runDockerSettingsMigration],
  ["runAiSettingsMigration", runAiSettingsMigration],
  ["runWakeOnLanSettingsMigration", runWakeOnLanSettingsMigration],
  ["runWarpgateSettingsMigration", runWarpgateSettingsMigration],
  ["runStepCaSettingsMigration", runStepCaSettingsMigration],
  ["runAcmeSslSettingsMigration", runAcmeSslSettingsMigration],
  ["runVaultSettingsMigration", runVaultSettingsMigration],
  ["runSecretSourcesTokenMigration", runSecretSourcesTokenMigration],
  ["runTotpMigration", runTotpMigration],
  ["runTermixIdentityCaMigration", runTermixIdentityCaMigration],
];

export async function runPluginDataMigrations(): Promise<void> {
  for (const [name, run] of MIGRATIONS) {
    try {
      await run();
    } catch (error) {
      databaseLogger.warn(`Plugin data migration ${name} failed`, {
        operation: "plugin_data_migration",
        error: getErrorMessage(error),
      });
    }
  }
}
