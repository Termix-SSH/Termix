/**
 * Runs a statement a sandboxed plugin sent, after sql-guard.ts passed it, on
 * the real database. The result is shaped the way Drizzle's proxy drivers
 * expect it in the plugin's process:
 *   sqlite-proxy: "all"/"values" -> rows as arrays, "get" -> one array,
 *                 "run" -> nothing;
 *   pg-proxy:     "all" -> rows as arrays, "execute" -> rows as objects;
 *   mysql-proxy:  "all" -> rows as arrays, "execute" -> [result header].
 */
import type { SqlDialect } from "./sql-guard.js";
import { nanToNull } from "../../database/db/nan-params.js";

export interface SqlResult {
  rows: unknown;
}

export interface SqlStatement {
  sql: string;
  params: unknown[];
  method: string;
}

/** Values a plugin may bind. Anything else becomes null. */
function bindable(values: unknown[]): unknown[] {
  return (nanToNull(values) as unknown[]).map((value) => {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint" ||
      typeof value === "boolean" ||
      Buffer.isBuffer(value) ||
      value instanceof Uint8Array ||
      value instanceof Date
    ) {
      return value instanceof Uint8Array && !Buffer.isBuffer(value)
        ? Buffer.from(value)
        : value;
    }
    return value === undefined ? null : JSON.stringify(value);
  });
}

async function sqliteHandle() {
  const { getSqlite } = await import("../../database/db/index.js");
  return getSqlite();
}

async function remotePool(): Promise<{
  query: (...args: unknown[]) => Promise<unknown>;
  connect?: () => Promise<unknown>;
  getConnection?: () => Promise<unknown>;
}> {
  const { getDb } = await import("../../database/db/index.js");
  const db = getDb() as unknown as { $client: unknown };
  const client = db.$client as { promise?: () => unknown };
  // mysql2's callback pool: its promise wrapper shares the same connections.
  return (
    typeof client.promise === "function" ? client.promise() : client
  ) as never;
}

function runSqlite(
  sqlite: Awaited<ReturnType<typeof sqliteHandle>>,
  sql: string,
  params: unknown[],
  method: string,
): SqlResult {
  const statement = sqlite.prepare(sql);
  const values = bindable(params);
  if (method === "run" || !statement.reader) {
    statement.run(...values);
    return { rows: [] };
  }
  statement.raw(true);
  if (method === "get") return { rows: statement.get(...values) ?? undefined };
  return { rows: statement.all(...values) };
}

export async function runPluginSql(
  dialect: SqlDialect,
  sql: string,
  params: unknown[],
  method: string,
): Promise<SqlResult> {
  if (dialect === "sqlite") {
    return runSqlite(await sqliteHandle(), sql, params, method);
  }
  const pool = await remotePool();
  return runRemote(pool, dialect, sql, params, method);
}

async function runRemote(
  client: { query: (...args: unknown[]) => Promise<unknown> },
  dialect: SqlDialect,
  sql: string,
  params: unknown[],
  method: string,
): Promise<SqlResult> {
  const values = bindable(params);
  if (dialect === "postgres") {
    if (method === "all") {
      const result = (await client.query({
        text: sql,
        values,
        rowMode: "array",
      })) as { rows: unknown[] };
      return { rows: result.rows };
    }
    const result = (await client.query({ text: sql, values })) as {
      rows: unknown[];
    };
    return { rows: result.rows };
  }
  if (method === "all") {
    const [rows] = (await client.query({ sql, rowsAsArray: true }, values)) as [
      unknown[],
    ];
    return { rows };
  }
  const [result] = (await client.query(sql, values)) as [unknown];
  return { rows: [result] };
}

/** Runs every statement in one transaction, or none of them. */
export async function runPluginSqlBatch(
  dialect: SqlDialect,
  statements: SqlStatement[],
): Promise<SqlResult[]> {
  if (dialect === "sqlite") {
    const sqlite = await sqliteHandle();
    const run = sqlite.transaction(() =>
      statements.map((s) => runSqlite(sqlite, s.sql, s.params, s.method)),
    );
    return run();
  }
  const pool = await remotePool();
  if (dialect === "postgres") {
    const client = (await pool.connect!()) as {
      query: (...args: unknown[]) => Promise<unknown>;
      release: () => void;
    };
    try {
      await client.query("BEGIN");
      const out: SqlResult[] = [];
      for (const s of statements) {
        out.push(await runRemote(client, dialect, s.sql, s.params, s.method));
      }
      await client.query("COMMIT");
      return out;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  const connection = (await pool.getConnection?.()) as
    | {
        query: (...args: unknown[]) => Promise<unknown>;
        beginTransaction: () => Promise<void>;
        commit: () => Promise<void>;
        rollback: () => Promise<void>;
        release: () => void;
      }
    | undefined;
  if (!connection) throw new Error("No MySQL connection for the batch");
  try {
    await connection.beginTransaction();
    const out: SqlResult[] = [];
    for (const s of statements) {
      out.push(await runRemote(connection, dialect, s.sql, s.params, s.method));
    }
    await connection.commit();
    return out;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}
