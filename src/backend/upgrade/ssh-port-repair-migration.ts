/**
 * Repairs SSH hosts that store two ports.
 *
 * 2.3 added `ssh_port` with a default of 22 and no backfill, and imports set
 * `port` only, so such a host dials `port` while `ssh_port` says 22. Host
 * defaults then took that 22 for an inherited value and could write it over
 * `port`. This copies `port` into `ssh_port` where that is clearly what the
 * host means, and marks the port as the host's own wherever the row has a
 * classified core list. It never writes `port`.
 *
 * Idempotent with no marker: a second run finds the rows repaired, already
 * own or left for the defaults pass. A linked desktop skips it, since sync
 * would push every repair as a local edit; it runs after unlinking.
 */

import type {
  HostDefaultsRepository,
  HostRow,
  SshPortRow,
} from "../database/repositories/host-defaults-repository.js";
import {
  CORE_NAMESPACE,
  parseDefaultOverrides,
} from "../../types/host-defaults.js";
import { databaseLogger } from "../utils/logger.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { getErrorMessage } from "../utils/error-message.js";

export interface SshPortRepairResult {
  /** Hosts written. */
  repaired: number[];
  /** Hosts whose two ports are kept, because either could be meant. */
  ambiguous: number[];
}

/**
 * What one mismatched row gets. Only the column's old default of 22, on a
 * host with SSH on and a valid `port`, is plainly stale.
 */
export function planSshPortRepair(row: SshPortRow): {
  values: Partial<HostRow>;
  ambiguous: boolean;
} {
  const port = Number(row.port);
  const stale =
    Number(row.sshPort) === 22 &&
    !!row.enableSsh &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536;
  const values: Partial<HostRow> = {};
  if (stale) values.sshPort = row.port;

  // A row without a core list is classified by its first defaults pass, which
  // keeps a remaining mismatch as own. Creating a partial list here would
  // make every other core key look inherited.
  const overrides = parseDefaultOverrides(row.defaultOverrides);
  const core = overrides?.[CORE_NAMESPACE];
  if (overrides && core && !core.includes("sshPort")) {
    values.defaultOverrides = JSON.stringify({
      ...overrides,
      [CORE_NAMESPACE]: [...core, "sshPort"].sort(),
    });
  }
  return { values, ambiguous: !stale };
}

/**
 * The row writes share one SQLite save, made even when a write fails part
 * way, instead of one save of the whole database per host.
 */
export const repairSshPorts = DatabaseSaveTrigger.batched(async function (
  repository: HostDefaultsRepository,
): Promise<SshPortRepairResult> {
  const result: SshPortRepairResult = { repaired: [], ambiguous: [] };
  for (const row of await repository.listSshPortMismatches()) {
    // MySQL's usual collation matches 'SSH' too.
    if (row.connectionType !== "ssh") continue;
    const { values, ambiguous } = planSshPortRepair(row);
    if (ambiguous) result.ambiguous.push(row.id);
    if (Object.keys(values).length === 0) continue;
    // Skipped when the row changed since it was read: the next boot retries.
    if (await repository.updateSshPortRow(row, values)) {
      result.repaired.push(row.id);
    }
  }
  return result;
});

/** Boot step. A failure is logged and never stops the boot. */
export async function runSshPortRepairMigration(): Promise<void> {
  try {
    const { listLinks } = await import("../sync/client/link-store.js");
    if ((await listLinks()).length > 0) return;
  } catch (error) {
    databaseLogger.warn("Skipped the SSH port repair: sync links unreadable", {
      operation: "ssh_port_repair_skipped",
      error: getErrorMessage(error),
    });
    return;
  }

  try {
    const { createCurrentHostDefaultsRepository } =
      await import("../database/repositories/factory.js");
    const { repaired, ambiguous } = await repairSshPorts(
      createCurrentHostDefaultsRepository(),
    );
    if (repaired.length > 0) {
      databaseLogger.info("Repaired hosts that stored two SSH ports", {
        operation: "ssh_port_repair",
        hostIds: repaired,
      });
    }
    if (ambiguous.length > 0) {
      databaseLogger.info(
        "Hosts keep two different SSH ports and connect on port",
        { operation: "ssh_port_repair_ambiguous", hostIds: ambiguous },
      );
    }
  } catch (error) {
    databaseLogger.warn("SSH port repair failed", {
      operation: "ssh_port_repair_failed",
      error: getErrorMessage(error),
    });
  }
}
