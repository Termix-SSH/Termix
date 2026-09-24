/**
 * The 2.8 to 2.9 LDAP split. LDAP rows in sso_providers (adopted or not yet)
 * move into the ldap plugin's table with their ids, their identities carry
 * the "ldap:" prefix, the SSO rows stay, and running it twice changes nothing.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../../database/db/index.js", () => ({ getDb: () => h.db }));
vi.mock("../../utils/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { databaseLogger: log };
});

const { runLdapProviderMigration } =
  await import("../../utils/crypto-migration/ldap-provider-migration.js");

let sqlite: Database.Database;

const LEGACY_DDL = `
  CREATE TABLE IF NOT EXISTS sso_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    display_order INTEGER NOT NULL DEFAULT 0,
    config TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

const TARGET_DDL = `
  CREATE TABLE IF NOT EXISTS "p_ldap_providers" (
    "id" integer PRIMARY KEY AUTOINCREMENT,
    "name" text NOT NULL,
    "enabled" integer NOT NULL DEFAULT 1,
    "display_order" integer NOT NULL DEFAULT 0,
    "config" text NOT NULL,
    "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

function setup(options: { adopted: boolean; target: boolean }) {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    ${LEGACY_DDL}
    CREATE TABLE user_external_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      email TEXT
    );
  `);
  const insert = sqlite.prepare(
    "INSERT INTO sso_providers (id, name, type, enabled, config) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run(3, "Keycloak", "oidc", 1, '{"client_id":"termix"}');
  insert.run(4, "Corp LDAP", "ldap", 1, '{"host":"ldap.example"}');
  insert.run(5, "Old LDAP", "ldap", 0, '{"host":"old.example"}');
  sqlite
    .prepare(
      "INSERT INTO user_external_identities (user_id, provider_id, subject) VALUES (?, ?, ?)",
    )
    .run("u-oidc", "3", "sub-1");
  sqlite
    .prepare(
      "INSERT INTO user_external_identities (user_id, provider_id, subject) VALUES (?, ?, ?)",
    )
    .run("u-ldap", "ldap:4", "bob");
  if (options.adopted) {
    sqlite.exec(`ALTER TABLE sso_providers RENAME TO p_sso_providers;`);
  }
  if (options.target) sqlite.exec(TARGET_DDL);
  h.db = drizzle(sqlite);
}

const all = (query: string) => sqlite.prepare(query).all();

describe("runLdapProviderMigration", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("does nothing until the ldap plugin's table exists", async () => {
    setup({ adopted: false, target: false });
    expect(await runLdapProviderMigration()).toEqual({
      moved: 0,
      renumbered: 0,
    });
    expect(all("SELECT id FROM sso_providers")).toHaveLength(3);
  });

  it.each([
    ["the legacy table", false],
    ["the adopted table", true],
  ])("moves LDAP rows out of %s with their ids", async (_label, adopted) => {
    setup({ adopted, target: true });
    const source = adopted ? "p_sso_providers" : "sso_providers";

    expect(await runLdapProviderMigration()).toEqual({
      moved: 2,
      renumbered: 0,
    });
    expect(
      all("SELECT id, name, enabled, config FROM p_ldap_providers ORDER BY id"),
    ).toEqual([
      {
        id: 4,
        name: "Corp LDAP",
        enabled: 1,
        config: '{"host":"ldap.example"}',
      },
      { id: 5, name: "Old LDAP", enabled: 0, config: '{"host":"old.example"}' },
    ]);
    expect(all(`SELECT id, type FROM ${source}`)).toEqual([
      { id: 3, type: "oidc" },
    ]);
    expect(
      all("SELECT user_id, provider_id FROM user_external_identities"),
    ).toEqual([
      { user_id: "u-oidc", provider_id: "3" },
      { user_id: "u-ldap", provider_id: "ldap:4" },
    ]);
  });

  it("renames bare identities left from before the prefix", async () => {
    setup({ adopted: true, target: true });
    sqlite.exec(
      "UPDATE user_external_identities SET provider_id = '4' WHERE user_id = 'u-ldap'",
    );
    await runLdapProviderMigration();
    expect(
      all(
        "SELECT provider_id FROM user_external_identities WHERE user_id = 'u-ldap'",
      ),
    ).toEqual([{ provider_id: "ldap:4" }]);
  });

  it("gives a row a new id when the plugin already used it", async () => {
    setup({ adopted: true, target: true });
    sqlite.exec(
      `INSERT INTO p_ldap_providers (id, name, config) VALUES (4, 'New', '{}')`,
    );
    sqlite
      .prepare(
        "INSERT INTO user_external_identities (user_id, provider_id, subject) VALUES (?, ?, ?)",
      )
      .run("u-bare", "4", "carol");

    const result = await runLdapProviderMigration();
    expect(result).toEqual({ moved: 2, renumbered: 1 });
    const moved = all(
      "SELECT id FROM p_ldap_providers WHERE name = 'Corp LDAP'",
    ) as Array<{ id: number }>;
    expect(moved[0].id).not.toBe(4);
    expect(
      all(
        "SELECT provider_id FROM user_external_identities WHERE user_id = 'u-bare'",
      ),
    ).toEqual([{ provider_id: `ldap:${moved[0].id}` }]);
  });

  it("is idempotent", async () => {
    setup({ adopted: true, target: true });
    await runLdapProviderMigration();
    expect(await runLdapProviderMigration()).toEqual({
      moved: 0,
      renumbered: 0,
    });
    expect(all("SELECT id FROM p_ldap_providers")).toHaveLength(2);
  });
});
