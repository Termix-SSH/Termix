/**
 * Runs the repository layer against a real Postgres or MySQL server.
 *
 * The unit tests only ever see SQLite, so the parts of this codebase that
 * differ per engine — the RETURNING replacements, the read-then-write
 * transactions, the value encoders — have no coverage there at all. This is
 * what covers them, and it needs a live server, which is why it is a script
 * rather than a test.
 *
 * Usage:
 *   node scripts/verify-dialects.mjs postgres://user:pass@host:5432/db
 *   node scripts/verify-dialects.mjs mysql://user:pass@host:3306/db
 *
 * Apply the migrations first (drizzle/postgres or drizzle/mysql); this script
 * assumes the schema exists and writes into it. Point it at a scratch database.
 */

import { randomUUID } from "crypto";

const url = process.argv[2];
if (!url) {
  console.error("usage: node scripts/verify-dialects.mjs <DATABASE_URL>");
  process.exit(2);
}

const scheme = url.split("://", 1)[0].toLowerCase();
const dialect = scheme.startsWith("postgres")
  ? "postgres"
  : scheme === "mysql" || scheme === "mariadb"
    ? "mysql"
    : null;

if (!dialect) {
  console.error(`unsupported URL scheme "${scheme}://"`);
  process.exit(2);
}

const { drizzle } = await import(
  dialect === "postgres" ? "drizzle-orm/node-postgres" : "drizzle-orm/mysql2"
);

// No schema option on purpose — see connect.ts.
const context = { dialect, drizzle: drizzle(url) };

const { UserRepository } =
  await import("../src/backend/database/repositories/user-repository.js");
const { HostRepository } =
  await import("../src/backend/database/repositories/host-repository.js");
const { SettingsRepository } =
  await import("../src/backend/database/repositories/settings-repository.js");

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${label}` +
      (ok
        ? ""
        : `\n          got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`),
  );
};

console.log(`\nverifying ${dialect} at ${url.replace(/:[^:@]*@/, ":***@")}\n`);

const users = new UserRepository(context);
const userId = `verify-${randomUUID()}`;

// insertReturning: on MySQL this is an insert plus a read inside a transaction.
const created = await users.create({
  id: userId,
  username: "before",
  passwordHash: "x",
  isAdmin: true,
});
check("insert returns the stored row", created?.username, "before");

// The one non-identity value encoder in the schema. Booleans are integers in
// the sqlite definitions the repositories import, so this asserts that 1/0
// survives a round trip through a native boolean column.
check("boolean true survives the round trip", created?.isAdmin, true);

// updateReturning must report the state AFTER the write. Reading first would
// return the value the update replaced — silently, with no error.
const updated = await users.update(userId, { username: "after" });
check("update returns the new value", updated?.username, "after");

const hosts = new HostRepository(context);
const host = await hosts.create({
  userId,
  name: "verify",
  ip: "127.0.0.1",
  port: 22,
  username: "root",
  authType: "password",
  enableTerminal: true,
});
check(
  "autoincrement id came back",
  typeof host?.id === "number" && host.id > 0,
  true,
);
check(
  "database-assigned createdAt came back",
  typeof host?.createdAt === "string" && host.createdAt.length > 0,
  true,
);

// deleteReturning must report the state BEFORE the write. Reading afterwards
// would find nothing at all.
const settings = new SettingsRepository(context);
const prefix = `verify-${randomUUID()}`;
await settings.set(`${prefix}-a`, "1");
await settings.set(`${prefix}-b`, "2");
check(
  "delete reports the rows it removed",
  await settings.deleteLike(`${prefix}-%`),
  2,
);
check(
  "and they are actually gone",
  (await settings.listAll()).filter((row) => row.key.startsWith(prefix)).length,
  0,
);

await hosts.deleteForUser(userId, host.id);
check("host really deleted", await hosts.findById(host.id), null);

console.log(
  failures === 0
    ? `\n${dialect}: all checks passed\n`
    : `\n${dialect}: ${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
