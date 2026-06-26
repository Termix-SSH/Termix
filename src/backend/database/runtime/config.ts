import path from "path";

export type DatabaseDialect = "sqlite" | "postgres" | "mysql";

export interface DatabaseRuntimeConfig {
  dialect: DatabaseDialect;
  url: string;
  sqlitePath?: string;
}

type EnvLike = Record<string, string | undefined>;

function normalizeDialect(value: string | undefined): DatabaseDialect {
  const raw = (value || "sqlite").trim().toLowerCase();
  if (raw === "sqlite") return "sqlite";
  if (raw === "postgres" || raw === "postgresql") return "postgres";
  if (raw === "mysql" || raw === "mariadb") return "mysql";
  throw new Error(
    `Unsupported DB_TYPE '${value}'. Expected sqlite, postgres, or mysql.`,
  );
}

function defaultSqliteUrl(env: EnvLike): string {
  const dataDir = env.DATA_DIR || "./db/data";
  return `file:${path.join(dataDir, "termix.sqlite")}`;
}

function sqlitePathFromUrl(url: string): string {
  if (url === ":memory:") return url;
  if (url.startsWith("file:")) return url.slice("file:".length);
  return url;
}

export function parseDatabaseRuntimeConfig(
  env: EnvLike = process.env,
): DatabaseRuntimeConfig {
  const dialect = normalizeDialect(env.DB_TYPE);
  const url =
    env.DATABASE_URL || (dialect === "sqlite" ? defaultSqliteUrl(env) : "");

  if (!url) {
    throw new Error(`DATABASE_URL is required when DB_TYPE is '${dialect}'.`);
  }

  if (dialect === "sqlite") {
    return {
      dialect,
      url,
      sqlitePath: sqlitePathFromUrl(url),
    };
  }

  return { dialect, url };
}

export function isExternalDatabase(dialect: DatabaseDialect): boolean {
  return dialect === "postgres" || dialect === "mysql";
}
