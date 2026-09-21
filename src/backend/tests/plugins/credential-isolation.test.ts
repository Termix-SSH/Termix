/**
 * The security test for the plugin runtime.
 *
 * The claim under test: a plugin worker cannot obtain plaintext credential
 * material through ANY ctx method. Rather than assert field-by-field, this
 * plants a unique sentinel string in every secret-bearing field of the resolved
 * host and then asserts that the sentinel appears in nothing the worker ever
 * receives -- return values, thrown error messages, or the ctx object itself.
 *
 * Every message crossing the boundary is recorded, so the assertion covers the
 * wire, not just what the plugin happened to look at.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixturePlugin, type Fixture } from "./fixture-plugin.js";

const SENTINEL = "SENT1NEL-plaintext-credential-do-not-leak";

const state = vi.hoisted(() => ({
  grants: [] as { pluginId: string; capability: string }[],
  /** Every message the main thread sent to a worker. */
  outbound: [] as unknown[],
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
  logAudit: vi.fn(async () => {}),
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

/** A host exactly as resolveHostById hands it over: secrets in the clear. */
const RESOLVED_HOST = {
  id: 42,
  name: "prod-box",
  ip: "10.0.0.5",
  port: 22,
  username: "root",
  folder: "Production",
  tags: ["prod"],
  authType: "password",
  enableTerminal: true,
  enableTunnel: true,
  enableFileManager: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  password: SENTINEL,
  key: SENTINEL,
  keyPassword: SENTINEL,
  certPublicKey: SENTINEL,
  sudoPassword: SENTINEL,
  autostartPassword: SENTINEL,
  autostartKey: SENTINEL,
  autostartKeyPassword: SENTINEL,
  credentialId: 7,
  vaultProfileId: 3,
};

function deepContains(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (value === null || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some((inner) =>
    deepContains(inner, needle),
  );
}

describe("plugin credential isolation", () => {
  const fixtures: Fixture[] = [];
  let loader: InstanceType<typeof PluginLoader> | null = null;
  let broker: InstanceType<typeof PluginBroker> | null = null;

  beforeEach(() => {
    state.grants = [
      { pluginId: "sample-plugin", capability: "hosts.read" },
      { pluginId: "sample-plugin", capability: "ssh.exec" },
      { pluginId: "sample-plugin", capability: "storage.own" },
    ];
    state.outbound = [];
    invalidatePluginPermissionCache();
  });

  afterEach(async () => {
    await loader?.shutdown();
    loader = null;
    broker = null;
    while (fixtures.length) fixtures.pop()!.cleanup();
  });

  /** Boots a plugin whose activate() runs `body` and reports the result. */
  async function attack(body: string, sshOpenFails = false) {
    const fixture = createFixturePlugin({
      permissions: ["hosts.read", "ssh.exec", "storage.own"],
      backendSource: `
        export async function activate(ctx) {
          let result;
          try {
            result = { ok: true, value: await (async () => { ${body} })() };
          } catch (error) {
            result = { ok: false, error: String(error && error.message) };
          }
          await ctx.log.info(JSON.stringify(result));
        }
      `,
    });
    fixtures.push(fixture);

    broker = new PluginBroker({
      listHosts: async () => [RESOLVED_HOST],
      resolveHost: async (hostId) => (hostId === 42 ? RESOLVED_HOST : null),
      ssh: {
        open: async () => {
          if (sshOpenFails) {
            // A failing connect must not spill the credential into the error
            // message either: this mirrors ssh2 embedding config on failure.
            throw new Error(
              `Authentication failed for root using password ${SENTINEL}`,
            );
          }
          return {
            release: () => {},
            exec: async () => ({
              stdout: "uptime: 4 days",
              stderr: "",
              code: 0,
            }),
          };
        },
      },
    });

    const logged: string[] = [];
    const { pluginLogger } = await import("../../utils/logger.js");
    vi.mocked(pluginLogger.info).mockImplementation((message: string) => {
      logged.push(message);
    });

    loader = new PluginLoader({
      onWorkerReady: (plugin, worker) => {
        // Record everything the main thread pushes at the worker.
        const original = worker.postMessage.bind(worker);
        worker.postMessage = ((message: unknown) => {
          state.outbound.push(message);
          return original(message);
        }) as typeof worker.postMessage;

        broker!.attach(plugin, worker);
      },
      onWorkerGone: (plugin) => broker!.detach(plugin.id),
    });

    await loader.load(fixture.dir);
    await loader.activate("sample-plugin", "user-1");

    const line = logged.find((entry) => entry.startsWith("{"));
    return line ? JSON.parse(line) : { ok: false, error: "no result" };
  }

  it(
    "ctx.hosts.get returns no credential material",
    async () => {
      const result = await attack(`return await ctx.hosts.get(42);`);

      expect(result.ok).toBe(true);
      expect(deepContains(result.value, SENTINEL)).toBe(false);
      for (const field of [
        "password",
        "key",
        "keyPassword",
        "certPublicKey",
        "sudoPassword",
        "autostartPassword",
        "autostartKey",
        "autostartKeyPassword",
        "credentialId",
        "vaultProfileId",
      ]) {
        expect(Object.keys(result.value)).not.toContain(field);
      }
    },
    WORKER_TIMEOUT,
  );

  it(
    "ctx.hosts.list returns no credential material",
    async () => {
      const result = await attack(`return await ctx.hosts.list();`);

      expect(result.ok).toBe(true);
      expect(deepContains(result.value, SENTINEL)).toBe(false);
    },
    WORKER_TIMEOUT,
  );

  it(
    "ctx.ssh.connect returns an opaque handle, not a connection",
    async () => {
      const result = await attack(`
        const handle = await ctx.ssh.connect(42);
        return {
          handle,
          type: typeof handle,
          // Anything reachable from the handle, if it were an object.
          reachable: typeof handle === "object" ? Object.keys(handle) : null,
        };
      `);

      expect(result.ok).toBe(true);
      expect(result.value.type).toBe("string");
      expect(result.value.handle).toMatch(/^sshconn:/);
      expect(result.value.handle).not.toContain(SENTINEL);
      // The handle is random, so it cannot encode the host or its secrets.
      expect(result.value.handle).not.toContain("10.0.0.5");
      expect(result.value.handle).not.toContain("root");
    },
    WORKER_TIMEOUT,
  );

  it(
    "ctx.ssh.exec returns only stdout, stderr and code",
    async () => {
      const result = await attack(`
        const handle = await ctx.ssh.connect(42);
        return await ctx.ssh.exec(handle, "uptime");
      `);

      expect(result.ok).toBe(true);
      expect(Object.keys(result.value).sort()).toEqual([
        "code",
        "stderr",
        "stdout",
      ]);
      expect(deepContains(result.value, SENTINEL)).toBe(false);
    },
    WORKER_TIMEOUT,
  );

  it(
    "a failing ctx.ssh.connect does not leak the credential in its error",
    async () => {
      const result = await attack(`return await ctx.ssh.connect(42);`, true);

      expect(result.ok).toBe(false);
      expect(result.error).not.toContain(SENTINEL);
    },
    WORKER_TIMEOUT,
  );

  it(
    "a plugin cannot walk ctx itself to a credential",
    async () => {
      const result = await attack(`
        const seen = new Set();
        const found = [];
        (function walk(value, path, depth) {
          if (depth > 6 || value === null || seen.has(value)) return;
          if (typeof value === "string") {
            if (value.includes(${JSON.stringify(SENTINEL)})) found.push(path);
            return;
          }
          if (typeof value !== "object" && typeof value !== "function") return;
          seen.add(value);
          for (const key of Object.getOwnPropertyNames(value)) {
            let inner;
            try { inner = value[key]; } catch { continue; }
            walk(inner, path + "." + key, depth + 1);
          }
        })(ctx, "ctx", 0);
        return found;
      `);

      expect(result.ok).toBe(true);
      expect(result.value).toEqual([]);
    },
    WORKER_TIMEOUT,
  );

  it(
    "no message sent to the worker ever contains credential material",
    async () => {
      await attack(`
        const host = await ctx.hosts.get(42);
        const list = await ctx.hosts.list();
        const handle = await ctx.ssh.connect(42);
        await ctx.ssh.exec(handle, "uptime");
        await ctx.storage.set("cache", { host, list });
        return await ctx.storage.get("cache");
      `);

      expect(state.outbound.length).toBeGreaterThan(0);
      const leaking = state.outbound.filter((message) =>
        deepContains(message, SENTINEL),
      );
      expect(leaking).toEqual([]);
    },
    WORKER_TIMEOUT,
  );

  it(
    "a plugin cannot exec on a handle it did not open",
    async () => {
      const result = await attack(`
        return await ctx.ssh.exec("sshconn:00000000-0000-0000-0000-000000000000", "id");
      `);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Unknown or closed SSH connection handle");
    },
    WORKER_TIMEOUT,
  );

  it(
    "a closed handle stops working",
    async () => {
      const result = await attack(`
        const handle = await ctx.ssh.connect(42);
        await ctx.ssh.close(handle);
        try {
          await ctx.ssh.exec(handle, "id");
          return "still worked";
        } catch (error) {
          return error.message;
        }
      `);

      expect(result.value).toContain("Unknown or closed SSH connection handle");
    },
    WORKER_TIMEOUT,
  );

  it(
    "ssh.connect is denied without the granted capability",
    async () => {
      state.grants = [{ pluginId: "sample-plugin", capability: "hosts.read" }];
      invalidatePluginPermissionCache();

      const result = await attack(`return await ctx.ssh.connect(42);`);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('is not granted the "ssh.exec"');
    },
    WORKER_TIMEOUT,
  );
});
