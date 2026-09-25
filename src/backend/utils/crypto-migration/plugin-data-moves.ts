/**
 * Core data that moves into a plugin's tables once they exist. Runs whenever
 * a plugin's migrations applied something, at boot or when a plugin is
 * enabled later, so the data is in place before the plugin's activate runs. Each move is
 * idempotent and does nothing until its target table exists.
 */

import { runLdapProviderMigration } from "./ldap-provider-migration.js";
import { runOpksshConfigMigration } from "./opkssh-config-migration.js";
import { runTermixIdentityCaMigration } from "./termix-identity-ca-migration.js";

export async function runPluginDataMoves(): Promise<void> {
  await runLdapProviderMigration();
  await runOpksshConfigMigration();
  await runTermixIdentityCaMigration();
}
