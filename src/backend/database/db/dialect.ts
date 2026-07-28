/**
 * Which engine the schema and repositories are built against.
 *
 * SQLite is not going away: the desktop app embeds its backend and cannot ship
 * a database server, so it will always run on SQLite. Postgres and MySQL are
 * for self-hosted deployments that need more than one process to reach the
 * data. This is a multi-backend story, not a migration off SQLite.
 */
export type DatabaseDialect = "sqlite" | "postgres" | "mysql";

export const DATABASE_DIALECT_ENV = "DATABASE_DIALECT";

const SUPPORTED: readonly DatabaseDialect[] = ["sqlite", "postgres", "mysql"];

export function isDatabaseDialect(value: unknown): value is DatabaseDialect {
  return (
    typeof value === "string" &&
    (SUPPORTED as readonly string[]).includes(value)
  );
}

/**
 * Resolves the configured dialect, defaulting to SQLite so existing
 * deployments and the desktop build are unaffected by this being added.
 */
export function resolveDatabaseDialect(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseDialect {
  const raw = env[DATABASE_DIALECT_ENV]?.trim().toLowerCase();
  if (!raw) return "sqlite";

  if (!isDatabaseDialect(raw)) {
    throw new Error(
      `Unsupported ${DATABASE_DIALECT_ENV}: "${raw}". Expected one of ${SUPPORTED.join(", ")}.`,
    );
  }
  return raw;
}
