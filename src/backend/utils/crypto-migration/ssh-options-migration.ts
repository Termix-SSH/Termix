/**
 * Copies each host's SSH connection options out of ssh_data.terminal_config
 * into ssh_data.ssh_options: keepalive, legacy algorithms, the agent socket
 * and identity, agent forwarding and environment variables. The terminal's
 * look and behavior in the same JSON belong to the ssh-terminal plugin and
 * are moved by upgrade/ssh-terminal-host-settings-migration.ts.
 *
 * terminal_config keeps its values; nothing reads these keys from it any
 * more. Old Cloudflare Access keys are left behind on purpose.
 *
 * Idempotent: only rows whose ssh_options is still null are read, and every
 * row it reads gets a value, even an empty object.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../logger.js";
import { runStatement, selectRows } from "./raw-rows.js";
import { parseSshOptions } from "../../hosts/ssh-options.js";

export interface SshOptionsMigrationResult {
  hostsMoved: number;
}

export async function runSshOptionsMigration(): Promise<SshOptionsMigrationResult> {
  let hostsMoved = 0;
  try {
    const rows = await selectRows<{
      id: number;
      terminal_config: string | null;
    }>(sql`
      SELECT id, terminal_config FROM ssh_data
      WHERE ssh_options IS NULL AND terminal_config IS NOT NULL
    `);
    for (const row of rows) {
      const options = parseSshOptions(row.terminal_config);
      await runStatement(sql`
        UPDATE ssh_data SET ssh_options = ${JSON.stringify(options)}
        WHERE id = ${row.id} AND ssh_options IS NULL
      `);
      if (Object.keys(options).length > 0) hostsMoved++;
    }
  } catch (error) {
    databaseLogger.warn("SSH options migration failed", {
      operation: "ssh_options_migration",
      error: error instanceof Error ? error.message : String(error),
    });
    return { hostsMoved };
  }

  if (hostsMoved > 0) {
    databaseLogger.info(
      `Moved SSH options for ${hostsMoved} host(s) out of terminal_config`,
      { operation: "ssh_options_migration" },
    );
  }
  return { hostsMoved };
}
