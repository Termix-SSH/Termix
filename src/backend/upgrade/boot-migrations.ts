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
import { runTailscaleSettingsMigration } from "./tailscale-settings-migration.js";
import { runProxmoxSettingsMigration } from "./proxmox-settings-migration.js";
import { runFileManagerSettingsMigration } from "./file-manager-settings-migration.js";
import { runTunnelsSettingsMigration } from "./tunnels-settings-migration.js";
import { runWebEndpointSettingsMigration } from "./web-endpoint-settings-migration.js";
import { runSshTerminalSettingsMigration } from "./ssh-terminal-settings-migration.js";
import { runTmuxMonitorSettingsMigration } from "./tmux-monitor-settings-migration.js";
import { runSessionSharingSettingsMigration } from "./session-sharing-settings-migration.js";
import { runSessionRecordingSettingsMigration } from "./session-recording-settings-migration.js";
import { runRemoteDesktopSettingsMigration } from "./remote-desktop-settings-migration.js";
import { runHostMetricsSettingsMigration } from "./host-metrics-settings-migration.js";
import { runDockerSettingsMigration } from "./docker-settings-migration.js";
import { runAiSettingsMigration } from "./ai-settings-migration.js";
import { runWakeOnLanSettingsMigration } from "./wake-on-lan-settings-migration.js";
import { runWarpgateSettingsMigration } from "./warpgate-settings-migration.js";
import { runStepCaSettingsMigration } from "./step-ca-settings-migration.js";
import { runAcmeSslSettingsMigration } from "./acme-ssl-settings-migration.js";
import { runVaultSettingsMigration } from "./vault-settings-migration.js";
import { runSecretSourcesTokenMigration } from "./secret-sources-token-migration.js";
import { runTotpMigration } from "./totp-migration.js";
import { runNotificationChannelMigration } from "./notification-channel-migration.js";
import { runTermixIdentityCaMigration } from "./termix-identity-ca-migration.js";

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
  ["runNotificationChannelMigration", runNotificationChannelMigration],
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
