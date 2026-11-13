/**
 * createMockCtx({ sandbox: true }) gives plugin authors the plugin process
 * rules in their own tests.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createMockCtx,
  createTestDb,
  SandboxRuleError,
} from "@termix-ssh/plugin-sdk/testing";

class Handle {
  secret = "x";
}

describe("createMockCtx sandbox mode", () => {
  const manifest = {
    sandbox: {
      schedules: [{ id: "poll", every: 60_000 }],
      events: ["plugin.other.done"],
      registry: ["sample.vars"],
    },
  };

  it("refuses undeclared schedules, topics and registry keys", () => {
    const { ctx } = createMockCtx({ sandbox: true, manifest });
    expect(() => ctx.schedule.every(1000, () => {})).toThrow(SandboxRuleError);
    expect(() => ctx.schedule.every(1000, () => {}, { id: "other" })).toThrow(
      /sandbox\.schedules/,
    );
    expect(() =>
      ctx.schedule.every(1000, () => {}, { id: "poll" }),
    ).not.toThrow();
    expect(() => ctx.events.on("plugin.other.started", () => {})).toThrow(
      /sandbox\.events/,
    );
    expect(() => ctx.events.on("plugin.other.done", () => {})).not.toThrow();
    expect(() => ctx.registry.provide("sample.other", 1)).toThrow(
      /sandbox\.registry/,
    );
  });

  it("refuses a class instance crossing into ctx", async () => {
    const { ctx } = createMockCtx({
      sandbox: true,
      capabilities: ["kv:own"],
      manifest,
    });
    expect(() => ctx.kv.set("k", new Handle())).toThrow(
      /Handle value can't cross/,
    );
    await expect(
      ctx.kv.set("k", { plain: [1, new Date(0)] }),
    ).resolves.toBeUndefined();
  });

  it("refuses methods core can't serve to a plugin process", () => {
    const { ctx } = createMockCtx({ sandbox: true, manifest });
    expect(() =>
      (ctx.hosts.locks as { provide: (p: unknown) => unknown }).provide({}),
    ).toThrow(/SANDBOX|not available to sandboxed plugins/);
  });

  it("has no db.transaction() but a batch that is all or nothing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tmx-sdk-db-"));
    fs.mkdirSync(path.join(dir, "migrations", "sqlite"), { recursive: true });
    const db = await createTestDb(dir, { skipMigrations: true });
    db.sqlite.exec("CREATE TABLE p_sample_rows (id INTEGER PRIMARY KEY)");
    const { ctx } = createMockCtx({
      sandbox: true,
      capabilities: ["db:own"],
      db: db.database,
      manifest,
    });
    const client = (await ctx.db.client()) as { transaction: () => unknown };
    expect(() => client.transaction()).toThrow(/ctx.db.batch/);
    const insert = (id: number) => ({
      toSQL: () => ({
        sql: "INSERT INTO p_sample_rows (id) VALUES (?)",
        params: [id],
      }),
    });
    await expect(ctx.db.batch([insert(1), insert(1)])).rejects.toThrow();
    expect(
      db.sqlite.prepare("SELECT count(*) AS n FROM p_sample_rows").get(),
    ).toEqual({ n: 0 });
    await ctx.db.batch([insert(1), insert(2)]);
    expect(
      db.sqlite.prepare("SELECT count(*) AS n FROM p_sample_rows").get(),
    ).toEqual({ n: 2 });
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("works exactly as before without the option", () => {
    const { ctx } = createMockCtx({ manifest });
    expect(() => ctx.schedule.every(1000, () => {})).not.toThrow();
  });
});
