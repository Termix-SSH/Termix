/**
 * Builds a 2.9.1 database on a real Postgres or MySQL server, seeds the rows
 * 26.10.0 rewrites or drops, then runs the real startup over it and checks
 * the result. 2.9.1 is the oldest database this version opens.
 *
 * Run through scripts/upgrade-check.sh, which starts the servers:
 *   tsx scripts/upgrade-check.mjs <postgres|mysql> <url> <legacy drizzle dir>
 *
 * Wipes the target database first.
 */

import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { getTableColumns, getTableName, is, sql, Table } from "drizzle-orm";

const [dialect, url, legacyRoot] = process.argv.slice(2);
if (!["postgres", "mysql"].includes(dialect) || !url || !legacyRoot) {
  console.error(
    "usage: tsx scripts/upgrade-check.mjs <postgres|mysql> <url> <legacy drizzle dir>",
  );
  process.exit(2);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = (file) => import(pathToFileURL(path.join(ROOT, file)).href);

const { drizzle } = await import(
  dialect === "postgres" ? "drizzle-orm/node-postgres" : "drizzle-orm/mysql2"
);
const db = drizzle(url);
const rows = (result) =>
  Array.isArray(result) ? result[0] : (result.rows ?? []);
// Written with Postgres quoting; MySQL gets backticks.
const exec = (text) =>
  db.execute(sql.raw(dialect === "postgres" ? text : text.replace(/"/g, "`")));
const one = async (text) => rows(await exec(text))[0];

if (dialect === "postgres") {
  await exec(`DROP SCHEMA public CASCADE`);
  await exec(`CREATE SCHEMA public`);
  await exec(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
} else {
  const tables = rows(
    await exec(
      `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()`,
    ),
  );
  await exec(`SET FOREIGN_KEY_CHECKS = 0`);
  for (const { name } of tables) await exec(`DROP TABLE IF EXISTS "${name}"`);
  await exec(`SET FOREIGN_KEY_CHECKS = 1`);
}

const { migrate } =
  dialect === "postgres"
    ? await import("drizzle-orm/node-postgres/migrator")
    : await import("drizzle-orm/mysql2/migrator");
await migrate(db, { migrationsFolder: path.join(legacyRoot, dialect) });
console.log(`${dialect}: 2.9.1 schema built`);

const yes = dialect === "postgres" ? "true" : "1";
await exec(
  `INSERT INTO "users" ("id", "username", "password_hash", "is_admin", "is_oidc", "oidc_identifier", "client_id") VALUES ('u1', 'alice', 'x', ${yes}, ${yes}, 'sub-1', 'cid')`,
);
await exec(
  `INSERT INTO "plugins" ("id", "name", "version", "state", "manifest_json") VALUES ('snippets', 'Snippets', '1.0.0', 'enabled', '{}')`,
);
await exec(
  `INSERT INTO "ssh_credentials" ("id", "user_id", "name", "auth_type", "username") VALUES (1, 'u1', 'cred', 'password', '$oidc.preferred_username')`,
);
await exec(
  `INSERT INTO "ssh_folders" ("id", "user_id", "name", "credential_id") VALUES (1, 'u1', 'f', 1)`,
);
await exec(
  `INSERT INTO "ssh_data" ("id", "user_id", "name", "ip", "port", "username", "auth_type", "enable_rdp", "folder") VALUES (1, 'u1', 'h', '10.0.0.1', 22, '$oidc.preferred_username', 'password', ${yes}, 'f')`,
);
// Its JSON quotes must not become backticks.
await db.execute(
  sql`UPDATE ssh_data SET terminal_config = ${JSON.stringify({ sudoPassword: "s3cret" })} WHERE id = 1`,
);
await exec(
  `INSERT INTO "sessions" ("id", "user_id", "jwt_token", "device_type", "device_info", "expires_at", "oidc_sub") VALUES ('s1', 'u1', 'jwt', 'web', 'ua', '2099-01-01', 'sub')`,
);
await exec(
  `INSERT INTO "settings" ("key", "value") VALUES ('host_defaults', '{}'), ('allow_registration', 'true'), ('guac_url', 'x')`,
);
await exec(
  `INSERT INTO "user_preferences" ("user_id", "terminal_macros", "rdp_defaults") VALUES ('u1', '[]', '{}')`,
);

process.env.DATABASE_DIALECT = dialect;
process.env.DATABASE_URL = url;
process.env.DRIZZLE_MIGRATIONS_DIR = path.join(ROOT, "drizzle");
const { initializeDatabase } = await load("src/backend/database/db/index.ts");
await initializeDatabase();

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : ` ${JSON.stringify(detail)}`}`,
  );
};

const schemaName = dialect === "postgres" ? "current_schema()" : "DATABASE()";
const columns = new Set(
  rows(
    await exec(
      `SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = ${schemaName}`,
    ),
  ).map((row) => `${row.t}.${row.c}`),
);

const { RETIRED_COLUMNS, REMOTE_RETIRED_COLUMNS } = await load(
  "src/backend/database/db/retired-columns.ts",
);
const leftover = [RETIRED_COLUMNS, REMOTE_RETIRED_COLUMNS].flatMap((group) =>
  Object.entries(group).flatMap(([table, names]) =>
    names.map((name) => `${table}.${name}`).filter((key) => columns.has(key)),
  ),
);
check("retired columns are gone", leftover.length === 0, leftover);

const schema = await load(
  `src/backend/database/db/schema.${dialect === "postgres" ? "pg" : "mysql"}.ts`,
);
const missing = Object.values(schema)
  .filter((value) => is(value, Table))
  .flatMap((table) =>
    Object.values(getTableColumns(table))
      .map((column) => `${getTableName(table)}.${column.name}`)
      .filter((key) => !columns.has(key)),
  );
check("every schema column exists", missing.length === 0, missing);

check(
  "user kept",
  (await one(`SELECT "username" FROM "users" WHERE "id" = 'u1'`))?.username ===
    "alice",
);
const host = await one(
  `SELECT "username", "sudo_password" FROM "ssh_data" WHERE "id" = 1`,
);
check(
  "host username placeholder rewritten",
  host?.username === "$external.username",
  host,
);
check(
  "sudo password moved out of terminal_config",
  host?.sudo_password === "s3cret",
  host,
);
const credential = await one(
  `SELECT "username" FROM "ssh_credentials" WHERE "id" = 1`,
);
check(
  "credential username placeholder rewritten",
  credential?.username === "$external.username",
  credential,
);
check(
  "folder kept",
  !!(await one(`SELECT "id" FROM "ssh_folders" WHERE "id" = 1`)),
);
check(
  "session kept",
  !!(await one(`SELECT "id" FROM "sessions" WHERE "id" = 's1'`)),
);
const keys = rows(await exec(`SELECT "key" FROM "settings"`)).map(
  (row) => row.key,
);
check(
  "retired settings deleted",
  !keys.includes("host_defaults") && !keys.includes("guac_url"),
  keys,
);
check("other settings kept", keys.includes("allow_registration"), keys);
check(
  "system roles seeded",
  rows(await exec(`SELECT "id" FROM "roles"`)).length > 0,
);

try {
  await initializeDatabase();
  check("a second start changes nothing", true);
} catch (error) {
  check("a second start changes nothing", false, String(error));
}

console.log(
  `\n${dialect}: ${failures ? `${failures} check(s) failed` : "all checks passed"}`,
);
process.exit(failures ? 1 : 0);
