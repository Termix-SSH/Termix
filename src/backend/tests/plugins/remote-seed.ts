/**
 * Puts a 2.8 install on a real Postgres or MySQL server for the upgrade test:
 * wipes the database, applies release-2.8.0-tag's own drizzle migrations
 * (UPGRADE_LEGACY_MIGRATIONS_DIR, which scripts/upgrade-check.sh extracts
 * from git), then copies every row of the SQLite fixture across. After that
 * the database is exactly what a 2.8 server left behind, and the normal boot
 * takes it the rest of the way.
 */

import Database from "better-sqlite3";
import { sql, type SQL } from "drizzle-orm";
import { ROWS } from "../fixtures/upgrade/rows.js";

export type RemoteDialect = "postgres" | "mysql";

type Remote = { execute: (query: SQL) => Promise<unknown> };

/** TEST_DIALECT, the same switch the repository tests use. */
export function remoteTestDialect(
  env: NodeJS.ProcessEnv = process.env,
): RemoteDialect | null {
  const value = env.TEST_DIALECT?.trim().toLowerCase();
  return value === "postgres" || value === "mysql" ? value : null;
}

async function rows<T>(db: Remote, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as { rows?: T[] } | T[];
  if (Array.isArray(result)) {
    return (Array.isArray(result[0]) ? result[0] : result) as T[];
  }
  return result.rows ?? [];
}

async function wipe(db: Remote, dialect: RemoteDialect): Promise<void> {
  if (dialect === "postgres") {
    await db.execute(sql.raw("DROP SCHEMA IF EXISTS drizzle CASCADE"));
    await db.execute(sql.raw("DROP SCHEMA public CASCADE"));
    await db.execute(sql.raw("CREATE SCHEMA public"));
    return;
  }
  const [{ name }] = await rows<{ name: string }>(
    db,
    sql.raw("SELECT DATABASE() AS name"),
  );
  await db.execute(sql.raw(`DROP DATABASE \`${name}\``));
  await db.execute(sql.raw(`CREATE DATABASE \`${name}\``));
  await db.execute(sql.raw(`USE \`${name}\``));
}

async function columnTypes(
  db: Remote,
  dialect: RemoteDialect,
  table: string,
): Promise<Map<string, string>> {
  const schema =
    dialect === "postgres" ? sql`current_schema()` : sql`DATABASE()`;
  const found = await rows<{ name: string; type: string }>(
    db,
    sql`SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = ${table}`,
  );
  return new Map(found.map((column) => [column.name, column.type]));
}

async function resyncSequence(db: Remote, table: string): Promise<void> {
  const [sequence] = await rows<{ name: string | null }>(
    db,
    sql.raw(
      `SELECT pg_get_serial_sequence('"${table}"', 'id') AS name FROM information_schema.columns ` +
        `WHERE table_schema = current_schema() AND table_name = '${table}' AND column_name = 'id'`,
    ),
  );
  if (!sequence?.name) return;
  await db.execute(
    sql.raw(
      `SELECT setval('${sequence.name}', COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`,
    ),
  );
}

export async function seedRemote28(
  dialect: RemoteDialect,
  url: string,
  fixture: Buffer,
): Promise<void> {
  const legacyMigrations = process.env.UPGRADE_LEGACY_MIGRATIONS_DIR;
  if (!legacyMigrations) {
    throw new Error(
      "UPGRADE_LEGACY_MIGRATIONS_DIR must point at release-2.8.0-tag's drizzle folder. Run scripts/upgrade-check.sh.",
    );
  }

  const { drizzle } =
    dialect === "postgres"
      ? await import("drizzle-orm/node-postgres")
      : await import("drizzle-orm/mysql2");
  const db = (
    drizzle as unknown as (
      config: unknown,
    ) => Remote & { $client: { end: () => Promise<void> } }
  )(
    dialect === "postgres"
      ? { connection: url }
      : { connection: { uri: url, connectionLimit: 1 } },
  );
  const source = new Database(fixture, { readonly: true });

  try {
    await wipe(db, dialect);

    const { runRemoteMigrations } =
      await import("../../database/db/migrate.js");
    await runRemoteMigrations(dialect, db as never, {
      DRIZZLE_MIGRATIONS_DIR: legacyMigrations,
    });

    for (const table of Object.keys(ROWS)) {
      const types = await columnTypes(db, dialect, table);
      if (types.size === 0) {
        throw new Error(`2.8's ${dialect} schema has no ${table} table`);
      }
      for (const row of source
        .prepare(`SELECT * FROM "${table}"`)
        .all() as Array<Record<string, unknown>>) {
        const columns = Object.keys(row).filter(
          (column) => types.has(column) && row[column] !== null,
        );
        const values = columns.map((column) =>
          types.get(column) === "boolean" ? Boolean(row[column]) : row[column],
        );
        await db.execute(
          sql`INSERT INTO ${sql.identifier(table)} (${sql.join(
            columns.map((column) => sql.identifier(column)),
            sql`, `,
          )}) VALUES (${sql.join(
            values.map((value) => sql`${value}`),
            sql`, `,
          )})`,
        );
      }
      if (dialect === "postgres") await resyncSequence(db, table);
    }
  } finally {
    source.close();
    await db.$client.end();
  }
}
