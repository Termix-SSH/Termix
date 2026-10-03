/**
 * 2.8 OIDC accounts with no provider id were filed under "legacy-oidc", but
 * the sso plugin signs in through the migrated provider row (#1381). They move
 * to that row when it is the only one from before 2.9 and the env provider is
 * not in use; anything ambiguous is left alone.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  db: null as unknown,
  warn: null as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock("../../database/db/index.js", () => ({ getDb: () => h.db }));
vi.mock("../../utils/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  h.warn = log.warn;
  return { databaseLogger: log };
});

const { runSsoLegacyIdentityMigration } =
  await import("../../upgrade/sso-legacy-identity-migration.js");

const ENV = [
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_ISSUER_URL",
  "OIDC_AUTHORIZATION_URL",
  "OIDC_TOKEN_URL",
  "OIDC_ENV_OVERRIDE",
];

let sqlite: Database.Database;

function setup(providers: Array<[number, string, number, number]>) {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, oidc_identifier TEXT);
    CREATE TABLE p_sso_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'x',
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      legacy_callback INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE user_external_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      email TEXT
    );
  `);
  const insert = sqlite.prepare(
    "INSERT INTO p_sso_providers (id, type, enabled, legacy_callback) VALUES (?, ?, ?, ?)",
  );
  for (const row of providers) insert.run(...row);
  h.db = drizzle(sqlite);
}

function addUser(id: string, identifier: string, providerId: string) {
  sqlite
    .prepare("INSERT INTO users (id, oidc_identifier) VALUES (?, ?)")
    .run(id, identifier);
  const subject = identifier.replace(/^github:[^:]+:/, "");
  sqlite
    .prepare(
      "INSERT INTO user_external_identities (user_id, provider_id, subject) VALUES (?, ?, ?)",
    )
    .run(id, providerId, subject);
}

function links() {
  return sqlite
    .prepare(
      "SELECT user_id, provider_id, subject FROM user_external_identities ORDER BY id",
    )
    .all();
}

beforeEach(() => {
  for (const name of ENV) delete process.env[name];
});

afterEach(() => {
  for (const name of ENV) delete process.env[name];
});

describe("runSsoLegacyIdentityMigration", () => {
  it("moves legacy OIDC sign-ins to the one migrated provider", async () => {
    setup([
      [1, "oidc", 1, 1],
      [2, "github", 1, 1],
    ]);
    addUser("alice", "sub-a", "legacy-oidc");
    addUser("gh", "github:null:42", "legacy-oidc");

    const result = await runSsoLegacyIdentityMigration();

    expect(result).toEqual({ moved: 1, conflicts: 0 });
    expect(links()).toEqual([
      { user_id: "alice", provider_id: "1", subject: "sub-a" },
      { user_id: "gh", provider_id: "legacy-oidc", subject: "42" },
    ]);
  });

  it("ignores OIDC providers added after the upgrade", async () => {
    setup([
      [1, "oidc", 1, 1],
      [5, "oidc", 1, 0],
    ]);
    addUser("alice", "sub-a", "legacy-oidc");

    await runSsoLegacyIdentityMigration();

    expect(links()).toEqual([
      { user_id: "alice", provider_id: "1", subject: "sub-a" },
    ]);
  });

  it("leaves them when two providers are from before 2.9", async () => {
    setup([
      [1, "oidc", 1, 1],
      [2, "oidc", 1, 1],
    ]);
    addUser("alice", "sub-a", "legacy-oidc");

    expect(await runSsoLegacyIdentityMigration()).toEqual({
      moved: 0,
      conflicts: 0,
    });
    expect(links()[0]).toMatchObject({ provider_id: "legacy-oidc" });
  });

  it("leaves them when the env provider signs in", async () => {
    setup([[1, "oidc", 1, 1]]);
    addUser("alice", "sub-a", "legacy-oidc");
    for (const name of ENV.slice(0, 5)) process.env[name] = "x";
    process.env.OIDC_ENV_OVERRIDE = "true";

    await runSsoLegacyIdentityMigration();

    expect(links()[0]).toMatchObject({ provider_id: "legacy-oidc" });
  });

  it("still moves them when env settings exist but the row is what signs in", async () => {
    setup([[1, "oidc", 1, 1]]);
    addUser("alice", "sub-a", "legacy-oidc");
    for (const name of ENV.slice(0, 5)) process.env[name] = "x";

    await runSsoLegacyIdentityMigration();

    expect(links()[0]).toMatchObject({ provider_id: "1" });
  });

  it("skips a subject a 2.9.0 duplicate account already holds", async () => {
    setup([[1, "oidc", 1, 1]]);
    addUser("alice", "sub-a", "legacy-oidc");
    sqlite
      .prepare(
        "INSERT INTO user_external_identities (user_id, provider_id, subject) VALUES ('dup', '1', 'sub-a')",
      )
      .run();

    const result = await runSsoLegacyIdentityMigration();

    expect(result).toEqual({ moved: 0, conflicts: 1 });
    expect(h.warn).toHaveBeenCalled();
    expect(links()).toHaveLength(2);
  });

  it("drops the legacy link once the same account holds the real one", async () => {
    setup([[1, "oidc", 1, 1]]);
    addUser("alice", "sub-a", "legacy-oidc");
    sqlite
      .prepare(
        "INSERT INTO user_external_identities (user_id, provider_id, subject) VALUES ('alice', '1', 'sub-a')",
      )
      .run();

    await runSsoLegacyIdentityMigration();

    expect(links()).toEqual([
      { user_id: "alice", provider_id: "1", subject: "sub-a" },
    ]);
  });

  it("is idempotent", async () => {
    setup([[1, "oidc", 1, 1]]);
    addUser("alice", "sub-a", "legacy-oidc");
    await runSsoLegacyIdentityMigration();
    expect(await runSsoLegacyIdentityMigration()).toEqual({
      moved: 0,
      conflicts: 0,
    });
  });
});
