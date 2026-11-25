import path from "path";
import { sql } from "drizzle-orm";
import type { DatabaseDialect } from "./dialect.js";
import type { PortableDatabase } from "../repositories/database-context.js";

export const MIGRATIONS_DIR_ENV = "DRIZZLE_MIGRATIONS_DIR";
export const PG_MIGRATION_LOCK_KEY = 0x54524d58; // "TRMX"
export const MYSQL_MIGRATION_LOCK_NAME = "termix_schema_migrations";
export const MYSQL_MIGRATION_LOCK_TIMEOUT_SEC = 60;

type PgPoolClientLike = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
};

type PgPoolLike = {
  connect: () => Promise<PgPoolClientLike>;
};

type MysqlConnectionLike = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
};

type MysqlPoolLike = {
  promise?: () => { getConnection: () => Promise<MysqlConnectionLike> };
  getConnection?: () => Promise<MysqlConnectionLike>;
};

type ExecutableDb = {
  execute: (query: unknown) => Promise<unknown>;
};

type MigrateFn = (
  db: unknown,
  config: { migrationsFolder: string },
) => Promise<void>;

function isPgPool(client: unknown): client is PgPoolLike {
  return (
    !!client &&
    typeof client === "object" &&
    typeof (client as { connect?: unknown }).connect === "function"
  );
}

function getMysqlConnectionOpener(
  client: unknown,
): (() => Promise<MysqlConnectionLike>) | null {
  if (!client || typeof client !== "object") return null;
  const pool = client as MysqlPoolLike;
  if (typeof pool.promise === "function") {
    const promised = pool.promise();
    if (promised && typeof promised.getConnection === "function") {
      return () => promised.getConnection();
    }
  }
  if (typeof pool.getConnection === "function") {
    return () => pool.getConnection!();
  }
  return null;
}

function isExecutableDb(db: unknown): db is ExecutableDb {
  return (
    !!db &&
    typeof db === "object" &&
    typeof (db as { execute?: unknown }).execute === "function"
  );
}

function assertMysqlLockAcquired(result: unknown): void {
  const rows = Array.isArray(result)
    ? Array.isArray(result[0])
      ? result[0]
      : result
    : [];
  const firstRow = rows[0] as Record<string, unknown> | undefined;
  if (firstRow && "locked" in firstRow && Number(firstRow.locked) !== 1) {
    throw new Error(
      `Failed to acquire MySQL migration lock "${MYSQL_MIGRATION_LOCK_NAME}" within ${MYSQL_MIGRATION_LOCK_TIMEOUT_SEC}s`,
    );
  }
}

async function runWithPostgresLock(
  db: PortableDatabase,
  folder: string,
  migrate: MigrateFn,
): Promise<void> {
  const client = (db as unknown as { $client?: unknown }).$client;
  if (isPgPool(client)) {
    const conn = await client.connect();
    let locked = false;
    try {
      await conn.query("SELECT pg_advisory_lock($1)", [PG_MIGRATION_LOCK_KEY]);
      locked = true;
      const { drizzle } = await import("drizzle-orm/node-postgres");
      await migrate(drizzle({ client: conn as never }), {
        migrationsFolder: folder,
      });
    } finally {
      if (locked) {
        await conn
          .query("SELECT pg_advisory_unlock($1)", [PG_MIGRATION_LOCK_KEY])
          .catch(() => {});
      }
      conn.release();
    }
    return;
  }

  if (isExecutableDb(db)) {
    let locked = false;
    try {
      await db.execute(sql`SELECT pg_advisory_lock(${PG_MIGRATION_LOCK_KEY})`);
      locked = true;
      await migrate(db, { migrationsFolder: folder });
    } finally {
      if (locked) {
        await db
          .execute(sql`SELECT pg_advisory_unlock(${PG_MIGRATION_LOCK_KEY})`)
          .catch(() => {});
      }
    }
    return;
  }

  await migrate(db, { migrationsFolder: folder });
}

async function runWithMysqlLock(
  db: PortableDatabase,
  folder: string,
  migrate: MigrateFn,
): Promise<void> {
  const client = (db as unknown as { $client?: unknown }).$client;
  const openConnection = getMysqlConnectionOpener(client);
  if (openConnection) {
    const conn = await openConnection();
    let locked = false;
    try {
      const result = await conn.query("SELECT GET_LOCK(?, ?) AS locked", [
        MYSQL_MIGRATION_LOCK_NAME,
        MYSQL_MIGRATION_LOCK_TIMEOUT_SEC,
      ]);
      assertMysqlLockAcquired(result);
      locked = true;
      const { drizzle } = await import("drizzle-orm/mysql2");
      await migrate(drizzle({ client: conn as never }), {
        migrationsFolder: folder,
      });
    } finally {
      if (locked) {
        await conn
          .query("SELECT RELEASE_LOCK(?)", [MYSQL_MIGRATION_LOCK_NAME])
          .catch(() => {});
      }
      conn.release();
    }
    return;
  }

  if (isExecutableDb(db)) {
    let locked = false;
    try {
      const result = await db.execute(
        sql`SELECT GET_LOCK(${MYSQL_MIGRATION_LOCK_NAME}, ${MYSQL_MIGRATION_LOCK_TIMEOUT_SEC}) AS locked`,
      );
      assertMysqlLockAcquired(result);
      locked = true;
      await migrate(db, { migrationsFolder: folder });
    } finally {
      if (locked) {
        await db
          .execute(sql`SELECT RELEASE_LOCK(${MYSQL_MIGRATION_LOCK_NAME})`)
          .catch(() => {});
      }
    }
    return;
  }

  await migrate(db, { migrationsFolder: folder });
}

/**
 * Where the generated migrations live.
 *
 * SQLite does not appear here: it builds its schema from the DDL in index.ts
 * and patches it forward with migrateSchema(). Only the client-server engines
 * use drizzle-kit migrations, and each has its own folder because the
 * generated SQL differs per dialect.
 */
export function migrationsFolder(
  dialect: DatabaseDialect,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env[MIGRATIONS_DIR_ENV]?.trim();
  const root = override || path.resolve(process.cwd(), "drizzle");
  return path.join(root, dialect);
}

/**
 * Brings a remote database up to the current schema.
 *
 * Acquires a database-level advisory lock so concurrent replicas starting
 * against the same database serialize their DDL migrations instead of racing.
 */
export async function runRemoteMigrations(
  dialect: DatabaseDialect,
  db: PortableDatabase,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (dialect === "sqlite") {
    throw new Error("SQLite builds its schema in index.ts, not from drizzle/");
  }

  const folder = migrationsFolder(dialect, env);

  const { migrate } =
    dialect === "postgres"
      ? await import("drizzle-orm/node-postgres/migrator")
      : await import("drizzle-orm/mysql2/migrator");

  const runMigrate = migrate as MigrateFn;
  if (dialect === "postgres") {
    await runWithPostgresLock(db, folder, runMigrate);
  } else {
    await runWithMysqlLock(db, folder, runMigrate);
  }
}
