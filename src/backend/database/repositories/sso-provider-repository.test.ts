import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { SsoProviderRepository } from "./sso-provider-repository.js";

describe("SsoProviderRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;
  let sqlite: Awaited<ReturnType<SqliteDatabaseAdapter["connect"]>>["sqlite"];

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
      sqlite = undefined;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<SsoProviderRepository> {
    adapter = new SqliteDatabaseAdapter({
      dialect: "sqlite",
      url: ":memory:",
      sqlitePath: ":memory:",
    });
    const context = await adapter.connect();
    sqlite = context.sqlite;
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_oidc INTEGER NOT NULL DEFAULT 0,
        sso_provider_id INTEGER
      );

      CREATE TABLE sso_providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        display_order INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    return new SsoProviderRepository(context, onWrite);
  }

  it("creates, lists, finds, updates, and deletes providers", async () => {
    const repo = await createRepository();

    const disabled = await repo.create({
      name: "Disabled",
      type: "oidc",
      enabled: false,
      displayOrder: 1,
      config: "{}",
    });
    const enabled = await repo.create({
      name: "GitHub",
      type: "github",
      enabled: true,
      displayOrder: 0,
      config: '{"client_id":"id"}',
    });

    expect((await repo.listEnabledPublic()).map((row) => row.id)).toEqual([
      enabled.id,
    ]);
    expect((await repo.listAll()).map((row) => row.id)).toEqual([
      enabled.id,
      disabled.id,
    ]);
    expect((await repo.findById(enabled.id))?.name).toBe("GitHub");
    expect((await repo.findFirstEnabledOidcLike())?.id).toBe(enabled.id);

    const updated = await repo.update(enabled.id, {
      name: "GitHub SSO",
      config: '{"client_id":"updated"}',
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
    expect(updated?.name).toBe("GitHub SSO");
    expect(updated?.config).toContain("updated");

    expect(await repo.delete(enabled.id)).toBe(true);
    expect(await repo.findById(enabled.id)).toBeNull();
    expect(await repo.delete(enabled.id)).toBe(false);
  });

  it("counts users associated with a provider", async () => {
    const repo = await createRepository();
    const provider = await repo.create({
      name: "LDAP",
      type: "ldap",
      enabled: true,
      displayOrder: 0,
      config: "{}",
    });

    sqlite?.exec(`
      INSERT INTO users (id, username, password_hash, sso_provider_id)
      VALUES ('user-1', 'u1', 'hash', ${provider.id}),
             ('user-2', 'u2', 'hash', ${provider.id}),
             ('user-3', 'u3', 'hash', NULL);
    `);

    expect(await repo.countUsersByProviderId(provider.id)).toBe(2);
  });

  it("runs the write hook after provider writes", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const provider = await repo.create({
      name: "OIDC",
      type: "oidc",
      enabled: true,
      displayOrder: 0,
      config: "{}",
    });
    await repo.update(provider.id, { enabled: false });
    await repo.delete(provider.id);
    await repo.delete(provider.id);

    expect(writeCount).toBe(3);
  });
});
