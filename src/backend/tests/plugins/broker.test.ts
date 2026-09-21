import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixturePlugin, type Fixture } from "./fixture-plugin.js";

const state = vi.hoisted(() => ({
  grants: [] as { pluginId: string; capability: string }[],
  auditEntries: [] as Record<string, unknown>[],
}));

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: vi.fn(async (params: Record<string, unknown>) => {
    state.auditEntries.push(params);
  }),
  getAuditUsername: vi.fn(async (userId: string) => `user:${userId}`),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async (pluginId: string) =>
      state.grants.filter((g) => g.pluginId === pluginId),
  }),
}));

const { PluginBroker } = await import("../../plugins/broker.js");
const { PluginLoader } = await import("../../plugins/loader.js");
const { invalidatePluginPermissionCache } =
  await import("../../plugins/permissions.js");

const WORKER_TIMEOUT = 30_000;

/**
 * A host as resolveHostById would return it: secrets in plaintext. The tests
 * assert none of this reaches the worker.
 */
const SECRET = "hunter2-plaintext-secret";
const RAW_HOST = {
  id: 42,
  name: "prod-box",
  ip: "10.0.0.5",
  port: 22,
  username: "root",
  folder: "Production",
  tags: ["prod"],
  authType: "password",
  enableTerminal: true,
  enableTunnel: false,
  enableFileManager: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  // None of these may ever cross the boundary.
  password: SECRET,
  key: SECRET,
  keyPassword: SECRET,
  certPublicKey: SECRET,
  sudoPassword: SECRET,
  autostartPassword: SECRET,
};

describe("PluginBroker", () => {
  const fixtures: Fixture[] = [];
  let loader: InstanceType<typeof PluginLoader> | null = null;
  let broker: InstanceType<typeof PluginBroker> | null = null;

  beforeEach(() => {
    state.grants = [];
    state.auditEntries = [];
    storage = memoryStorage();
    invalidatePluginPermissionCache();
  });

  afterEach(async () => {
    await loader?.shutdown();
    loader = null;
    broker = null;
    // The bus is a module singleton, so a leftover listener would leak between
    // tests.
    const { pluginEvents } = await import("../../plugins/events.js");
    pluginEvents.clear();
    while (fixtures.length) fixtures.pop()!.cleanup();
  });

  function grant(capability: string, pluginId = "sample-plugin") {
    state.grants.push({ pluginId, capability });
    invalidatePluginPermissionCache(pluginId);
  }

  /**
   * Boots a real worker whose activate() runs `body` and reports the outcome
   * back through a ctx.log call the test can read.
   */
  /** In-memory stand-in for PluginStorageRepository, scoped per plugin. */
  function memoryStorage() {
    const rows = new Map<string, string>();
    const at = (pluginId: string, key: string) => `${pluginId}\u0000${key}`;

    return {
      rows,
      backend: {
        get: async (pluginId: string, key: string) =>
          rows.get(at(pluginId, key)) ?? null,
        set: async (pluginId: string, key: string, value: string) => {
          rows.set(at(pluginId, key), value);
        },
        delete: async (pluginId: string, key: string) =>
          rows.delete(at(pluginId, key)),
        listKeys: async (pluginId: string) =>
          [...rows.keys()]
            .filter((k) => k.startsWith(`${pluginId}\u0000`))
            .map((k) => k.split("\u0000")[1]),
      },
    };
  }

  let storage = memoryStorage();

  async function boot(body: string, permissions?: string[]) {
    const fixture = createFixturePlugin({
      permissions: permissions ?? ["hosts.read", "storage.own"],
      backendSource: `
        export async function activate(ctx) {
          globalThis.__result = undefined;
          try {
            globalThis.__result = { ok: true, value: await (async () => { ${body} })() };
          } catch (error) {
            globalThis.__result = { ok: false, error: error.message };
          }
          await ctx.log.info(JSON.stringify(globalThis.__result));
        }
      `,
    });
    fixtures.push(fixture);

    broker = new PluginBroker({
      listHosts: async () => [RAW_HOST],
      resolveHost: async (hostId) => (hostId === 42 ? RAW_HOST : null),
      storage: storage.backend,
    });

    const logged: string[] = [];
    const { pluginLogger } = await import("../../utils/logger.js");
    vi.mocked(pluginLogger.info).mockImplementation((message: string) => {
      logged.push(message);
    });

    loader = new PluginLoader({
      onWorkerReady: (plugin, worker) => broker!.attach(plugin, worker),
      onWorkerGone: (plugin) => broker!.detach(plugin.id),
    });

    await loader.load(fixture.dir);
    await loader.activate("sample-plugin", "user-1");

    const line = logged.find((entry) => entry.startsWith("{"));
    return line ? JSON.parse(line) : { ok: false, error: "no result reported" };
  }

  describe("permission gate", () => {
    it(
      "allows a call whose capability is declared and granted",
      async () => {
        grant("hosts.read");
        const result = await boot(`return await ctx.hosts.get(42);`);

        expect(result.ok).toBe(true);
        expect(result.value).toMatchObject({ id: 42, name: "prod-box" });
      },
      WORKER_TIMEOUT,
    );

    it(
      "denies a declared capability that was never granted",
      async () => {
        const result = await boot(`return await ctx.hosts.get(42);`);

        expect(result.ok).toBe(false);
        expect(result.error).toContain('is not granted the "hosts.read"');
      },
      WORKER_TIMEOUT,
    );

    it(
      "denies a granted capability the manifest never declared",
      async () => {
        // Granted in the database, but absent from the manifest: widening a
        // plugin's reach must require a new manifest, not just a grant.
        grant("hosts.read");
        const result = await boot(`return await ctx.hosts.get(42);`, [
          "storage.own",
        ]);

        expect(result.ok).toBe(false);
        expect(result.error).toContain('is not granted the "hosts.read"');
      },
      WORKER_TIMEOUT,
    );

    it(
      "rejects an unknown ctx method",
      async () => {
        const result = await boot(
          `return await new Promise((resolve, reject) => {
             ctx.hosts.__proto__; resolve("noop");
           });`,
        );
        expect(result.ok).toBe(true);
      },
      WORKER_TIMEOUT,
    );
  });

  describe("credential isolation", () => {
    it(
      "never sends credential material to the worker",
      async () => {
        grant("hosts.read");
        const result = await boot(`
          const host = await ctx.hosts.get(42);
          const list = await ctx.hosts.list();
          const blob = JSON.stringify({ host, list });
          if (blob.includes(${JSON.stringify(SECRET)})) {
            throw new Error("SECRET LEAKED: " + blob);
          }
          return { keys: Object.keys(host).sort(), listLength: list.length };
        `);

        expect(result.ok).toBe(true);
        expect(result.value.listLength).toBe(1);
        expect(result.value.keys).not.toContain("password");
        expect(result.value.keys).not.toContain("key");
        expect(result.value.keys).not.toContain("keyPassword");
        expect(result.value.keys).not.toContain("certPublicKey");
        expect(result.value.keys).not.toContain("sudoPassword");
        expect(result.value.keys).not.toContain("autostartPassword");
      },
      WORKER_TIMEOUT,
    );

    it(
      "returns null rather than distinguishing missing from forbidden",
      async () => {
        grant("hosts.read");
        const result = await boot(`return await ctx.hosts.get(999);`);

        expect(result.ok).toBe(true);
        expect(result.value).toBeNull();
      },
      WORKER_TIMEOUT,
    );
  });

  describe("audit", () => {
    it(
      "writes one plugin-attributed line per permitted call",
      async () => {
        grant("hosts.read");
        await boot(`return await ctx.hosts.get(42);`);

        const entry = state.auditEntries.find(
          (e) => e.action === "plugin_hosts_get",
        );
        expect(entry).toBeDefined();
        expect(entry).toMatchObject({
          userId: "user-1",
          username: "plugin:sample-plugin",
          resourceType: "plugin",
          resourceId: "sample-plugin",
          success: true,
        });
      },
      WORKER_TIMEOUT,
    );

    it(
      "audits a denied call as a failure",
      async () => {
        await boot(`return await ctx.hosts.get(42);`);

        const entry = state.auditEntries.find(
          (e) => e.action === "plugin_hosts_get",
        );
        expect(entry).toMatchObject({
          username: "plugin:sample-plugin",
          success: false,
        });
        expect(String(entry?.errorMessage)).toContain("is not granted");
      },
      WORKER_TIMEOUT,
    );

    it(
      "does not let a plugin forge the actor or smuggle bulk details",
      async () => {
        grant("hosts.read");
        // ctx.log takes a context object, so this exercises the summariser on
        // an argument a plugin genuinely controls.
        await boot(`
          await ctx.log.info("hello", { username: "admin", userId: "user-999" });
          return await ctx.hosts.get(42);
        `);

        const entry = state.auditEntries.find(
          (e) => e.action === "plugin_hosts_get",
        );
        // Attribution is broker-set regardless of what the plugin passed.
        expect(entry?.username).toBe("plugin:sample-plugin");
        expect(entry?.userId).toBe("user-1");

        // No audit entry anywhere claims the user the plugin named.
        expect(
          state.auditEntries.some(
            (e) => e.userId === "user-999" || e.username === "admin",
          ),
        ).toBe(false);
      },
      WORKER_TIMEOUT,
    );

    it(
      "summarises rather than records a long string argument",
      async () => {
        grant("hosts.read");
        await boot(`
          try { await ctx.hosts.get("${"x".repeat(500)}"); } catch {}
          return "done";
        `);

        const entry = state.auditEntries.find(
          (e) => e.action === "plugin_hosts_get",
        );
        const details = String(entry?.details);
        // Capped, so a plugin cannot write bulk data into the audit trail.
        expect(details.length).toBeLessThan(200);
        expect(details).not.toContain("x".repeat(200));
      },
      WORKER_TIMEOUT,
    );
  });

  describe("ctx.storage", () => {
    it(
      "round-trips a structured value",
      async () => {
        grant("storage.own");
        const result = await boot(`
          await ctx.storage.set("prefs", { theme: "dark", count: 3 });
          const read = await ctx.storage.get("prefs");
          const keys = await ctx.storage.list();
          return { read, keys };
        `);

        expect(result.ok).toBe(true);
        expect(result.value.read).toEqual({ theme: "dark", count: 3 });
        expect(result.value.keys).toEqual(["prefs"]);
      },
      WORKER_TIMEOUT,
    );

    it(
      "returns null for a key that was never set",
      async () => {
        grant("storage.own");
        const result = await boot(`return await ctx.storage.get("nope");`);

        expect(result.ok).toBe(true);
        expect(result.value).toBeNull();
      },
      WORKER_TIMEOUT,
    );

    it(
      "deletes a key",
      async () => {
        grant("storage.own");
        const result = await boot(`
          await ctx.storage.set("temp", 1);
          await ctx.storage.delete("temp");
          return await ctx.storage.list();
        `);

        expect(result.ok).toBe(true);
        expect(result.value).toEqual([]);
      },
      WORKER_TIMEOUT,
    );

    it(
      "scopes writes to the calling plugin, which cannot name another scope",
      async () => {
        grant("storage.own");
        // A plugin only ever supplies a key; the plugin id is added by the
        // broker, so there is no argument through which to reach another
        // plugin's rows.
        await boot(`await ctx.storage.set("owned", "value");`);

        const keys = [...storage.rows.keys()];
        expect(keys).toEqual(["sample-plugin\u0000owned"]);
      },
      WORKER_TIMEOUT,
    );

    it(
      "denies storage without the granted capability",
      async () => {
        const result = await boot(`return await ctx.storage.get("prefs");`);

        expect(result.ok).toBe(false);
        expect(result.error).toContain('is not granted the "storage.own"');
      },
      WORKER_TIMEOUT,
    );

    it(
      "rejects an empty key and an oversized value",
      async () => {
        grant("storage.own");
        const result = await boot(`
          const errors = [];
          try { await ctx.storage.set("", 1); } catch (e) { errors.push(e.message); }
          try {
            await ctx.storage.set("big", "x".repeat(300000));
          } catch (e) { errors.push(e.message); }
          return errors;
        `);

        expect(result.ok).toBe(true);
        expect(result.value[0]).toContain("non-empty key");
        expect(result.value[1]).toContain("byte limit");
      },
      WORKER_TIMEOUT,
    );
  });

  describe("ctx.schedule", () => {
    it(
      "registers a timer and fires the plugin's handler",
      async () => {
        grant("storage.own");
        const result = await boot(`
          await new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("timer never fired")), 8000);
            await ctx.schedule.every(1000, async () => {
              clearTimeout(timer);
              resolve();
            });
          });
          return "fired";
        `);

        expect(result.ok).toBe(true);
        expect(result.value).toBe("fired");
      },
      WORKER_TIMEOUT,
    );

    it(
      "rejects an interval below the floor",
      async () => {
        grant("storage.own");
        const result = await boot(
          `return await ctx.schedule.every(5, () => {});`,
        );

        expect(result.ok).toBe(false);
        expect(result.error).toContain("at least 1000ms");
      },
      WORKER_TIMEOUT,
    );

    it(
      "cancel stops the timer and drops it from the runtime",
      async () => {
        grant("storage.own");
        await boot(`
          const id = await ctx.schedule.every(1000, () => {});
          await ctx.schedule.cancel(id);
        `);

        expect(broker!.get("sample-plugin")!.timers.size).toBe(0);
      },
      WORKER_TIMEOUT,
    );
  });

  describe("ctx.events", () => {
    it(
      "pushes a subscribed topic through to the plugin's listener",
      async () => {
        grant("events.read");
        const { pluginEvents } = await import("../../plugins/events.js");

        // The plugin subscribes during activate, then reports what it sees on
        // the next event. boot() resolves once activate returns, so the emit
        // below happens with the subscription already live.
        await boot(
          `
          await ctx.events.on("host.status", async (payload) => {
            await ctx.log.info("EVENT:" + JSON.stringify(payload));
          });
        `,
          ["events.read"],
        );

        const runtime = broker!.get("sample-plugin")!;
        expect(runtime.subscriptions.has("host.status")).toBe(true);
        expect(pluginEvents.listenerCount("host.status")).toBe(1);

        const pushed: unknown[] = [];
        const original = runtime.worker.postMessage.bind(runtime.worker);
        runtime.worker.postMessage = ((message: unknown) => {
          pushed.push(message);
          return original(message);
        }) as typeof runtime.worker.postMessage;

        pluginEvents.emit("host.status", { hostId: 42, online: true });

        expect(pushed).toContainEqual({
          kind: "event",
          key: "host.status",
          payload: { hostId: 42, online: true },
        });
      },
      WORKER_TIMEOUT,
    );

    it(
      "refuses to emit outside the plugin's own namespace",
      async () => {
        grant("events.read");
        const result = await boot(
          `
          const errors = [];
          try {
            await ctx.events.emit("host.status", { hostId: 1, online: false });
          } catch (e) { errors.push(e.message); }
          await ctx.events.emit("plugin.sample-plugin.ready", { ok: true });
          return errors;
        `,
          ["events.read"],
        );

        expect(result.ok).toBe(true);
        expect(result.value[0]).toContain(
          'may only publish topics beginning with "plugin.sample-plugin."',
        );
      },
      WORKER_TIMEOUT,
    );

    it(
      "denies subscribing without the events.read capability",
      async () => {
        const result = await boot(
          `return await ctx.events.on("host.status", () => {});`,
          ["events.read"],
        );

        expect(result.ok).toBe(false);
        expect(result.error).toContain('is not granted the "events.read"');
      },
      WORKER_TIMEOUT,
    );

    it(
      "drops bus subscriptions when the plugin detaches",
      async () => {
        grant("events.read");
        const { pluginEvents } = await import("../../plugins/events.js");

        await boot(`await ctx.events.on("host.status", () => {});`, [
          "events.read",
        ]);

        expect(pluginEvents.listenerCount("host.status")).toBe(1);
        broker!.detach("sample-plugin");
        expect(pluginEvents.listenerCount("host.status")).toBe(0);
      },
      WORKER_TIMEOUT,
    );
  });

  describe("detach", () => {
    it(
      "releases ssh handles and timers when the worker goes away",
      async () => {
        grant("hosts.read");
        await boot(`return await ctx.hosts.get(42);`);

        const runtime = broker!.get("sample-plugin");
        expect(runtime).toBeDefined();

        let released = false;
        runtime!.sshHandles.set("sshconn:test", {
          hostId: 42,
          release: () => {
            released = true;
          },
        });
        runtime!.timers.set(
          "t1",
          setInterval(() => {}, 10_000),
        );

        broker!.detach("sample-plugin");

        expect(released).toBe(true);
        expect(broker!.get("sample-plugin")).toBeUndefined();
      },
      WORKER_TIMEOUT,
    );
  });
});
