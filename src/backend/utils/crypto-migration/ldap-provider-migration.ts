/**
 * Moves 2.8 LDAP directories into the ldap plugin.
 *
 * 2.8 kept LDAP and SSO providers in one sso_providers table. The sso plugin
 * adopts that table (as p_sso_providers) and ignores its LDAP rows; this
 * copies them into p_ldap_providers once the ldap plugin has created it, then
 * deletes them from the source.
 *
 * Ids are kept, because users.oidc_identifier ("ldap:<id>:<uid>") and their
 * identities ("ldap:<id>") name them. Bare "<id>" identities from before the
 * prefix are renamed too. It runs before the ldap plugin first activates, so
 * the plugin cannot have used an id yet; if it somehow has, the old row gets
 * a fresh id and only its bare identities follow it.
 *
 * Needs neither plugin to be running, only their tables. Idempotent.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../logger.js";
import { resolveDatabaseDialect } from "../../database/db/dialect.js";
import { runStatement, selectRows } from "./raw-rows.js";

const TARGET = "p_ldap_providers";
const SOURCES = ["p_sso_providers", "sso_providers"];

interface LegacyRow {
  id: number;
  name: string;
  enabled: unknown;
  display_order: number;
  config: string;
  created_at: string;
  updated_at: string;
}

export interface LdapProviderMigrationResult {
  /** Directories copied into the plugin's table. */
  moved: number;
  /** Of those, how many needed a new id. */
  renumbered: number;
}

async function tableExists(name: string): Promise<boolean> {
  try {
    await selectRows(sql`SELECT 1 FROM ${sql.identifier(name)} WHERE 1 = 0`);
    return true;
  } catch {
    return false;
  }
}

function isOn(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t";
}

async function renameIdentities(from: string, to: string): Promise<void> {
  await runStatement(
    sql`UPDATE user_external_identities SET provider_id = ${to} WHERE provider_id = ${from}`,
  );
}

/** Explicit ids leave a Postgres sequence behind them. */
async function syncSequence(): Promise<void> {
  if (resolveDatabaseDialect() !== "postgres") return;
  await runStatement(
    sql`SELECT setval(pg_get_serial_sequence(${TARGET}, 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${sql.identifier(TARGET)}))`,
  );
}

async function insertRow(row: LegacyRow, id: number | null): Promise<number> {
  const enabled = isOn(row.enabled);
  const values = sql`${row.name}, ${resolveDatabaseDialect() === "sqlite" ? (enabled ? 1 : 0) : enabled}, ${row.display_order ?? 0}, ${row.config}, ${row.created_at}, ${row.updated_at}`;
  if (id !== null) {
    await runStatement(
      sql`INSERT INTO ${sql.identifier(TARGET)} (id, name, enabled, display_order, config, created_at, updated_at) VALUES (${id}, ${values})`,
    );
    return id;
  }
  await runStatement(
    sql`INSERT INTO ${sql.identifier(TARGET)} (name, enabled, display_order, config, created_at, updated_at) VALUES (${values})`,
  );
  const [inserted] = await selectRows<{ id: number }>(
    sql`SELECT MAX(id) AS id FROM ${sql.identifier(TARGET)}`,
  );
  return Number(inserted.id);
}

export async function runLdapProviderMigration(): Promise<LdapProviderMigrationResult> {
  const result: LdapProviderMigrationResult = { moved: 0, renumbered: 0 };
  try {
    if (!(await tableExists(TARGET))) return result;

    for (const source of SOURCES) {
      if (!(await tableExists(source))) continue;
      const rows = await selectRows<LegacyRow>(
        sql`SELECT id, name, enabled, display_order, config, created_at, updated_at FROM ${sql.identifier(source)} WHERE type = 'ldap' ORDER BY id`,
      );

      // Rows whose id is free keep it; the rest go last, so a fresh id can
      // never land on one that is still waiting to be copied.
      const clashing: LegacyRow[] = [];
      for (const row of rows) {
        const taken = await selectRows(
          sql`SELECT id FROM ${sql.identifier(TARGET)} WHERE id = ${row.id}`,
        );
        if (taken.length > 0) {
          clashing.push(row);
          continue;
        }
        await insertRow(row, row.id);
        await renameIdentities(String(row.id), `ldap:${row.id}`);
        await runStatement(
          sql`DELETE FROM ${sql.identifier(source)} WHERE id = ${row.id}`,
        );
        result.moved++;
      }
      if (clashing.length > 0) await syncSequence();
      for (const row of clashing) {
        const id = await insertRow(row, null);
        // "ldap:<id>" already names the plugin's own directory, so only the
        // bare ids from before the prefix can follow this one.
        await renameIdentities(String(row.id), `ldap:${id}`);
        await runStatement(
          sql`DELETE FROM ${sql.identifier(source)} WHERE id = ${row.id}`,
        );
        result.moved++;
        result.renumbered++;
      }
    }

    if (result.moved > 0) await syncSequence();

    if (result.moved > 0) {
      databaseLogger.info("Moved LDAP directories into the ldap plugin", {
        operation: "ldap_provider_migration",
        ...result,
      });
    }
  } catch (error) {
    databaseLogger.error("LDAP directory migration failed", error, {
      operation: "ldap_provider_migration_failed",
    });
  }
  return result;
}
