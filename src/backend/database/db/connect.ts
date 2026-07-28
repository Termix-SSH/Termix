import type { DatabaseDialect } from "./dialect.js";
import type { PortableDatabase } from "../repositories/database-context.js";

export const DATABASE_URL_ENV = "DATABASE_URL";

/**
 * Opens a connection to a client-server engine.
 *
 * SQLite is not handled here — it has its own lifecycle in db/index.ts, where
 * the database is decrypted into memory and serialised back to a file. This
 * covers the engines that connect to something already running.
 *
 * The returned handle is typed as PortableDatabase; see the note there on why
 * that is an approximation and what guarantees it.
 */
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env[DATABASE_URL_ENV]?.trim();
  return url ? url : null;
}

/**
 * Checks the connection string suits the configured engine before trying to
 * open it, so a mismatch fails with something readable rather than a driver
 * error thirty frames down.
 */
export function assertUrlMatchesDialect(
  url: string,
  dialect: DatabaseDialect,
): void {
  const scheme = url.split("://", 1)[0].toLowerCase();

  const expected: Record<string, readonly string[]> = {
    postgres: ["postgres", "postgresql"],
    mysql: ["mysql", "mariadb"],
  };

  const allowed = expected[dialect];
  if (!allowed) {
    throw new Error(`${dialect} does not use ${DATABASE_URL_ENV}`);
  }

  if (!allowed.includes(scheme)) {
    throw new Error(
      `${DATABASE_URL_ENV} is a "${scheme}://" URL but DATABASE_DIALECT is "${dialect}". ` +
        `Expected one of ${allowed.map((s) => `${s}://`).join(", ")}.`,
    );
  }
}

export async function connectRemoteDatabase(
  dialect: DatabaseDialect,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PortableDatabase> {
  const url = databaseUrl(env);
  if (!url) {
    throw new Error(
      `${DATABASE_URL_ENV} must be set when DATABASE_DIALECT is "${dialect}".`,
    );
  }

  assertUrlMatchesDialect(url, dialect);

  // No `schema` option: it only feeds drizzle's relational query API
  // (`db.query.*`), which nothing here uses. The query builder takes its table
  // names and value encoders from the table objects the repositories import —
  // see the note in schema.pg.ts on why the generated schemas are DDL-only.
  if (dialect === "postgres") {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    return drizzle(url) as unknown as PortableDatabase;
  }

  const { drizzle } = await import("drizzle-orm/mysql2");
  return drizzle(url) as unknown as PortableDatabase;
}
