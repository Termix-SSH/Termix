/**
 * A user's rows in plugin tables, for the per-user exports and imports.
 *
 * Core never names a plugin table. Any table a running plugin declared with a
 * refUser column belongs to a user, so it travels with that user's export.
 * Encrypted columns stay behind: they are sealed with this server's keys.
 */

import { sql } from "drizzle-orm";
import { columnName, createTableSql } from "@termix/plugin-sdk/ddl";
import { prefixedTableName } from "@termix/plugin-sdk/db";
import type { PluginTableDefinition } from "@termix/plugin-sdk/db";
import {
  runStatement,
  selectRows,
} from "../utils/crypto-migration/raw-rows.js";
import { listAllTables } from "./data.js";

export interface UserOwnedTable {
  pluginId: string;
  /** The physical table name, p_<id>_<name>. */
  table: string;
  /** The legacy core name the table adopted, for older export files. */
  legacyName?: string;
  userColumn: string;
  /** Other refUser columns, such as a grantee or the user who shared. */
  otherUserColumns: string[];
  /** refHost columns. */
  hostColumns: string[];
  /** Columns that travel, as SQL names. The primary key and secrets do not. */
  columns: string[];
  definition: PluginTableDefinition;
}

export function listUserOwnedTables(): UserOwnedTable[] {
  const owned: UserOwnedTable[] = [];
  for (const { pluginId, definition } of listAllTables()) {
    const entries = Object.entries(definition.columns);
    const user = entries.find(([, column]) => column.type === "refUser");
    if (!user) continue;
    owned.push({
      pluginId,
      table: prefixedTableName(pluginId, definition.name),
      legacyName: definition.adopts,
      userColumn: columnName(user[0], user[1]),
      otherUserColumns: entries
        .filter(([, column]) => column.type === "refUser")
        .slice(1)
        .map(([property, column]) => columnName(property, column)),
      hostColumns: entries
        .filter(([, column]) => column.type === "refHost")
        .map(([property, column]) => columnName(property, column)),
      columns: entries
        .filter(
          ([, column]) =>
            column.type !== "id" &&
            !column.primaryKey &&
            column.type !== "encryptedText",
        )
        .map(([property, column]) => columnName(property, column)),
      definition,
    });
  }
  return owned;
}

type Row = Record<string, unknown>;

async function readOwnedRows(
  owned: UserOwnedTable,
  userId: string,
): Promise<Row[]> {
  try {
    return await selectRows<Row>(
      sql`SELECT ${sql.join(
        owned.columns.map((column) => sql.identifier(column)),
        sql`, `,
      )} FROM ${sql.identifier(owned.table)} WHERE ${sql.identifier(
        owned.userColumn,
      )} = ${userId}`,
    );
  } catch {
    // The plugin's migration has not created the table yet.
    return [];
  }
}

const yieldToEventLoop = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

/** The user's rows in every user-owned plugin table, keyed by table. */
export async function readUserPluginRows(
  userId: string,
): Promise<Record<string, Row[]>> {
  const result: Record<string, Row[]> = {};
  for (const owned of listUserOwnedTables()) {
    const rows = await readOwnedRows(owned, userId);
    if (rows.length > 0) result[owned.table] = rows;
    await yieldToEventLoop();
  }
  return result;
}

interface SqliteLike {
  exec(source: string): unknown;
  prepare(source: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  transaction?(fn: (rows: Row[]) => void): (rows: Row[]) => unknown;
}

const INSERT_CHUNK = 2000;

/**
 * Writes the user's plugin rows into a SQLite export file. One table at a
 * time, in chunked transactions with a yield between them: history tables
 * (command history, health checks) can hold many thousands of rows, and the
 * export runs on the thread that serves every other request.
 */
export async function writeUserPluginTables(
  exportDb: SqliteLike,
  userId: string,
): Promise<number> {
  let written = 0;
  for (const owned of listUserOwnedTables()) {
    const rows = await readOwnedRows(owned, userId);
    if (!rows.length) continue;
    for (const statement of createTableSql(
      "sqlite",
      owned.pluginId,
      owned.definition,
    )) {
      exportDb.exec(statement);
    }
    const insert = exportDb.prepare(
      `INSERT INTO "${owned.table}" (${owned.columns
        .map((column) => `"${column}"`)
        .join(", ")}) VALUES (${owned.columns.map(() => "?").join(", ")})`,
    );
    const writeChunk = (chunk: Row[]) => {
      for (const row of chunk) {
        insert.run(...owned.columns.map((column) => toSqlite(row[column])));
      }
    };
    const runChunk = exportDb.transaction
      ? exportDb.transaction(writeChunk)
      : writeChunk;
    for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
      const chunk = rows.slice(start, start + INSERT_CHUNK);
      runChunk(chunk);
      written += chunk.length;
      await yieldToEventLoop();
    }
  }
  return written;
}

function toSqlite(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

export interface PluginRowsImport {
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Whether a row from an import file may be written as `userId`. The file is
 * user input, so a reference to anyone else's user or host is not trusted:
 * other user columns must point back at the row's own owner, and host columns
 * at a host the importing user owns.
 */
async function rowReferencesAllowed(
  owned: UserOwnedTable,
  source: Row,
  userId: string,
): Promise<boolean> {
  const owner = source[owned.userColumn];
  for (const column of owned.otherUserColumns) {
    const value = source[column];
    if (value !== null && value !== undefined && value !== owner) return false;
  }
  for (const column of owned.hostColumns) {
    const value = source[column];
    if (value === null || value === undefined) continue;
    const rows = await selectRows(
      sql`SELECT 1 FROM ${sql.identifier("ssh_data")} WHERE ${sql.identifier(
        "id",
      )} = ${value} AND ${sql.identifier("user_id")} = ${userId} LIMIT 1`,
    );
    if (rows.length === 0) return false;
  }
  return true;
}

/**
 * Copies plugin rows from an import file into this server as `userId`. A row
 * matching one the user already has is skipped, and so is one that points at
 * another user or at a host the importer does not own. Files from before 2.9
 * carry the legacy table names, which are read too.
 */
export async function importUserPluginRows(
  importDb: SqliteLike,
  userId: string,
): Promise<PluginRowsImport> {
  const summary: PluginRowsImport = { imported: 0, skipped: 0, errors: [] };

  for (const owned of listUserOwnedTables()) {
    let rows: Row[] | null = null;
    for (const name of [owned.table, owned.legacyName].filter(Boolean)) {
      try {
        rows = importDb.prepare(`SELECT * FROM "${name}"`).all() as Row[];
        break;
      } catch {
        // not in this file under that name
      }
    }
    if (!rows) continue;

    for (const source of rows) {
      const columns = owned.columns.filter(
        (column) => column === owned.userColumn || source[column] !== undefined,
      );
      const owner = source[owned.userColumn];
      const values = columns.map((column) =>
        column === owned.userColumn ||
        (owned.otherUserColumns.includes(column) && source[column] === owner)
          ? userId
          : source[column],
      );
      try {
        if (!(await rowReferencesAllowed(owned, source, userId))) {
          summary.skipped++;
          continue;
        }
        const existing = await selectRows(
          sql`SELECT 1 FROM ${sql.identifier(owned.table)} WHERE ${sql.join(
            columns.map((column, index) =>
              values[index] === null
                ? sql`${sql.identifier(column)} IS NULL`
                : sql`${sql.identifier(column)} = ${values[index]}`,
            ),
            sql` AND `,
          )} LIMIT 1`,
        );
        if (existing.length > 0) {
          summary.skipped++;
          continue;
        }
        await runStatement(
          sql`INSERT INTO ${sql.identifier(owned.table)} (${sql.join(
            columns.map((column) => sql.identifier(column)),
            sql`, `,
          )}) VALUES (${sql.join(
            values.map((value) => sql`${value}`),
            sql`, `,
          )})`,
        );
        summary.imported++;
      } catch (error) {
        summary.errors.push(
          `${owned.table} import error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  return summary;
}
