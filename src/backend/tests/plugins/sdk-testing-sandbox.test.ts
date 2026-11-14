/**
 * createMockCtx({ sandbox: true }) gives plugin authors the plugin process
 * rules in their own tests.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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

  it("lets a process handle's exit Promise through", async () => {
    const { ctx } = createMockCtx({
      sandbox: true,
      capabilities: ["process:spawn"],
      manifest,
      process: {
        run: async () => ({
          pid: 1,
          onStdout: () => {},
          onStderr: () => {},
          kill: () => {},
          exited: Promise.resolve({ code: 0, signal: null }),
        }),
      },
    });
    const handle = await ctx.process.run("/bin/true", []);
    await expect(handle.exited).resolves.toEqual({ code: 0, signal: null });
  });

  it("reads the base URL from a live request, as the plugin process does", () => {
    const { ctx } = createMockCtx({
      sandbox: true,
      manifest,
      baseUrl: "https://termix.test",
    });
    expect(ctx.http.baseUrl(new Handle() as never)).toBe("https://termix.test");
  });

  it("takes async auth hooks and login methods", () => {
    const { ctx } = createMockCtx({
      sandbox: true,
      capabilities: ["auth:provide"],
      manifest: {
        ...manifest,
        contributes: {
          auth: {
            sshAuthTypes: ["x"],
            loginMethods: ["m"],
            keyboardInteractive: ["k"],
          },
        },
      },
    });
    expect(() =>
      ctx.auth.registerSshAuthProvider({
        type: "x",
        labelKey: "x",
        prepare: async () => ({ status: "ready" }),
        onBanner: async () => undefined,
      }),
    ).not.toThrow();
    expect(() =>
      ctx.auth.registerKeyboardInteractiveHandler({
        id: "k",
        label: "K",
        detect: async () => null,
      }),
    ).not.toThrow();
    expect(() =>
      ctx.auth.registerLoginMethod({
        id: "m",
        labelKey: "m",
        kind: "form",
        verify: async () => ({ kind: "user", userId: "u" }),
      }),
    ).not.toThrow();
  });

  it("lets a login method set only its own cookies", async () => {
    const { ctx, auth } = createMockCtx({
      sandbox: true,
      capabilities: ["auth:provide"],
      manifest: {
        ...manifest,
        id: "sample-x",
        contributes: { auth: { loginMethods: ["m"] } },
      },
    });
    ctx.auth.registerLoginMethod({
      id: "m",
      labelKey: "m",
      kind: "redirect",
      start: async (request) => {
        const res = request.res as {
          cookie: (n: string, v: string, o: object) => void;
        };
        res.cookie(String(request.body.name), "v", {});
        return { redirectUrl: "https://idp" };
      },
    });
    const start = auth.loginMethods[0].start!;
    const set = vi.fn();
    const request = (name: string) => ({
      body: { name },
      query: {},
      headers: {},
      res: { cookie: set, clearCookie: vi.fn() },
    });
    await expect(start(request("tmxp_sample_x_s"), null)).resolves.toEqual({
      redirectUrl: "https://idp",
    });
    expect(set).toHaveBeenCalledTimes(1);
    await expect(start(request("jwt"), null)).rejects.toThrow(/tmxp_/);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("lets fetch take an AbortSignal, as the plugin process does", async () => {
    const { ctx } = createMockCtx({
      sandbox: true,
      capabilities: ["network:outbound"],
      manifest,
      fetch: async () => new Response("ok"),
    });
    const response = await ctx.fetch("https://example.com", {
      signal: new AbortController().signal,
    });
    expect(await response.text()).toBe("ok");
  });

  it("lets asUser hand back a live object", async () => {
    const { ctx } = createMockCtx({
      sandbox: true,
      capabilities: ["users:impersonate"],
      manifest,
    });
    const handle = new Handle();
    await expect(ctx.asUser("user-1", async () => handle)).resolves.toBe(
      handle,
    );
  });

  it("refuses methods core can't serve to a plugin process", () => {
    const { ctx } = createMockCtx({ sandbox: true, manifest });
    expect(() =>
      (ctx.hosts.locks as { provide: (p: unknown) => unknown }).provide({}),
    ).toThrow(/SANDBOX|not available to sandboxed plugins/);
  });

  it("keeps the plugin's own ssh2 client and socket out of what crosses", async () => {
    const { ctx } = createMockCtx({
      sandbox: true,
      capabilities: ["ssh:connect", "credentials:use", "credentials:read"],
      manifest,
    });
    const host = { id: 1, ip: "10.0.0.1", port: 22, username: "me" };
    const prepared = await ctx.ssh.prepare(host as never, {
      purpose: "terminal",
      client: new Handle() as never,
      hostKeySocket: new Handle() as never,
      log: () => {},
    });
    expect(prepared.config).toMatchObject({ host: "10.0.0.1" });
    await expect(
      ctx.ssh.openTransport(host as never, prepared.config, {
        prompt: { ask: async () => null },
      }),
    ).resolves.toMatchObject({ via: "direct" });
    const { PassThrough } = await import("node:stream");
    await expect(
      ctx.ssh.connect(1, { sock: new PassThrough() } as never),
    ).resolves.toBeDefined();
    await expect(
      ctx.ssh.openTransport(host as never, {} as never),
    ).rejects.toThrow(/config from ctx.ssh.prepare/);
    await expect(
      ctx.ssh.prepare(host as never, {
        purpose: "terminal",
        client: {} as never,
        serverHostId: new Handle() as never,
      }),
    ).rejects.toThrow(/can't cross/);
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
    // Drizzle queries are class instances; they turn into SQL first.
    class Query {
      toSQL() {
        return {
          sql: "INSERT INTO p_sample_rows (id) VALUES (?)",
          params: [3],
        };
      }
    }
    await ctx.db.batch([new Query()] as never);
    await expect(ctx.db.batch([{}] as never)).rejects.toThrow(
      /Drizzle queries/,
    );
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("works exactly as before without the option", () => {
    const { ctx } = createMockCtx({ manifest });
    expect(() => ctx.schedule.every(1000, () => {})).not.toThrow();
  });
});
