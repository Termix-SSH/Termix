import path from "path";
import type { DatabaseDialect } from "./dialect.js";
import type { PortableDatabase } from "../repositories/database-context.js";

export const MIGRATIONS_DIR_ENV = "DRIZZLE_MIGRATIONS_DIR";

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
 * drizzle's migrator records what it has applied in its own table, so this is
 * safe to run on every start — including against a database another instance
 * already migrated.
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

  await (migrate as (db: unknown, config: { migrationsFolder: string }) => Promise<void>)(
    db,
    { migrationsFolder: folder },
  );
}
