/**
 * plugin_settings cleanup when a user or host goes.
 *
 * scope_id is polymorphic, so it carries no foreign key and the engine will
 * not cascade it. The repositories delete these rows explicitly, and these
 * tests exist so a later refactor that drops those calls fails here rather
 * than leaving orphaned settings behind forever.
 */

import { asc } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./repositories/test-support.js";
import { HostRepository } from "../../database/repositories/host-repository.js";
import { UserRepository } from "../../database/repositories/user-repository.js";
import type { DatabaseContext } from "../../database/repositories/database-context.js";
import { pluginSettings } from "../../database/db/schema.js";

let adapter: TestSqliteDatabase | null = null;
let ctx: DatabaseContext | null = null;

afterEach(async () => {
  if (adapter) {
    await adapter.close();
    adapter = null;
    ctx = null;
  }
});

async function seed(): Promise<DatabaseContext> {
  adapter = new TestSqliteDatabase();
  const context = await adapter.connect();
  ctx = context;

  await adapter.exec(`
    INSERT INTO users (id, username, password_hash)
    VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');

    INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type)
    VALUES
      (7, 'user-1', 'seven', '10.0.0.7', 22, 'root', 'password'),
      (8, 'user-1', 'eight', '10.0.0.8', 22, 'root', 'password'),
      (9, 'user-2', 'nine', '10.0.0.9', 22, 'root', 'password');

    INSERT INTO plugins (id, name, version, manifest_json)
    VALUES ('sample', 'Sample', '1.0.0', '{}');
  `);

  return context;
}

async function addSetting(
  scope: string,
  scopeId: string | null,
  key = "k",
): Promise<void> {
  await adapter!.exec(
    `INSERT INTO plugin_settings (plugin_id, scope, scope_id, key, value)
     VALUES ('sample', '${scope}', ${scopeId === null ? "NULL" : `'${scopeId}'`}, '${key}', '"v"')`,
  );
}

async function remaining(): Promise<
  { scope: string; scopeId: string | null }[]
> {
  const rows = await ctx!.drizzle
    .select({
      scope: pluginSettings.scope,
      scopeId: pluginSettings.scopeId,
    })
    .from(pluginSettings)
    .orderBy(asc(pluginSettings.scope), asc(pluginSettings.scopeId));
  return rows;
}

describe("user deletion", () => {
  it("removes that user's plugin settings", async () => {
    const context = await seed();
    await addSetting("user", "user-1");

    await new UserRepository(context).delete("user-1");

    expect(await remaining()).toEqual([]);
  });

  it("leaves another user's settings alone", async () => {
    const context = await seed();
    await addSetting("user", "user-1");
    await addSetting("user", "user-2");

    await new UserRepository(context).delete("user-1");

    expect(await remaining()).toEqual([{ scope: "user", scopeId: "user-2" }]);
  });

  it("leaves admin-scope settings alone", async () => {
    const context = await seed();
    await addSetting("admin", null);
    await addSetting("user", "user-1");

    await new UserRepository(context).delete("user-1");

    expect(await remaining()).toEqual([{ scope: "admin", scopeId: null }]);
  });
});

describe("host deletion", () => {
  it("removes that host's plugin settings", async () => {
    const context = await seed();
    await addSetting("host", "7");

    await new HostRepository(context).deleteForUser("user-1", 7);

    expect(await remaining()).toEqual([]);
  });

  it("leaves another host's settings alone", async () => {
    const context = await seed();
    await addSetting("host", "7");
    await addSetting("host", "8");

    await new HostRepository(context).deleteForUser("user-1", 7);

    expect(await remaining()).toEqual([{ scope: "host", scopeId: "8" }]);
  });

  it("clears settings for every host in the bulk delete path", async () => {
    const context = await seed();
    await addSetting("host", "7");
    await addSetting("host", "8");
    await addSetting("host", "9");

    await new HostRepository(context).deleteByUserId("user-1");

    // Host 9 belongs to another user and keeps its settings.
    expect(await remaining()).toEqual([{ scope: "host", scopeId: "9" }]);
  });

  it("does not confuse a host id with a user id", async () => {
    const context = await seed();
    await addSetting("host", "7");
    await addSetting("user", "7");

    await new HostRepository(context).deleteForUser("user-1", 7);

    expect(await remaining()).toEqual([{ scope: "user", scopeId: "7" }]);
  });
});
