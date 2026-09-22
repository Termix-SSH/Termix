/**
 * Two real plugins on disk, one providing a service and one requiring it,
 * driven through the actual PluginLoader.
 *
 * The service ("testplugin.greet") and the permission gating it
 * ("testplugin.greet.use") are fixture-owned, so nothing about the shipped
 * plugins is under test here even though the fixtures borrow their ids.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Fixture } from "./fixture-plugin.js";

const state = vi.hoisted(() => ({
  /** Permissions the acting user currently holds. Mutated mid-test. */
  granted: new Set<string>(),
  auditEntries: [] as Record<string, unknown>[],
  /** Records every delegated call, to prove the gate runs before the provider. */
  providerCalls: [] as string[],
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

vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      hasPermission: async (_userId: string, permission: string) =>
        state.granted.has(permission),
      invalidateUserPermissionCache: vi.fn(),
    }),
  },
}));

const { PluginLoader } = await import("../../plugins/loader.js");
const {
  clearServiceRegistry,
  getRegistration,
  PluginServicePermissionError,
  PluginServiceUnavailableError,
} = await import("../../plugins/service-registry.js");
const { pluginEvents } = await import("../../plugins/events.js");
const { createFixturePlugin } = await import("./fixture-plugin.js");

const SERVICE = "testplugin.greet";
const PERMISSION = "testplugin.greet.use";

/**
 * The provider publishes a greet service and records every delegated call to
 * a file, so the test can prove a denied call never reached it. A module-level
 * variable would not work: the plugin is imported by URL into this process and
 * lives in its own ESM module instance.
 */
function providerSource(callLog: string): string {
  const literal = JSON.stringify(callLog);
  return `
import fs from "node:fs";
export async function activate(ctx) {
  ctx.services.provide(${JSON.stringify(SERVICE)}, {
    hello: async (name) => {
      fs.appendFileSync(${literal}, name + "\\n");
      return "hello " + name;
    },
  });
}
`;
}

/**
 * The consumer takes a handle at activation and stashes it on globalThis so
 * the test can call it as a specific user afterwards.
 */
const CONSUMER_SOURCE = `
export async function activate(ctx) {
  globalThis.__consumerHandle = ctx.services.get(${JSON.stringify(SERVICE)});
}
`;

function providerFixture(): Fixture {
  return createFixturePlugin({
    id: "ssh-terminal",
    capabilities: ["kv:own"],
    manifestOverrides: {
      category: "Terminal",
      provides: [
        { service: SERVICE, version: "1.2.0", permission: PERMISSION },
      ],
      contributes: {
        permissionGroup: { group: "testplugin", permissions: [PERMISSION] },
      },
    },
  });
}

function consumerFixture(
  requires: Array<Record<string, unknown>> = [
    { service: SERVICE, versionRange: "^1.2.0" },
  ],
): Fixture {
  return createFixturePlugin({
    id: "docker",
    capabilities: ["kv:own"],
    backendSource: CONSUMER_SOURCE,
    manifestOverrides: { category: "Infrastructure", requires },
  });
}

type GreetHandle = {
  hello: (name: string) => Promise<string>;
  asUser: (userId: string) => { hello: (name: string) => Promise<string> };
};

function handle(): GreetHandle {
  return (globalThis as Record<string, unknown>)
    .__consumerHandle as GreetHandle;
}

describe("plugin service contracts", () => {
  let provider: Fixture | null = null;
  let consumer: Fixture | null = null;
  let loader: InstanceType<typeof PluginLoader> | null = null;
  let callLog = "";

  beforeEach(() => {
    state.granted = new Set([PERMISSION]);
    state.auditEntries = [];
    state.providerCalls = [];
    clearServiceRegistry();
    pluginEvents.clear();
  });

  afterEach(async () => {
    await loader?.shutdown();
    loader = null;
    provider?.cleanup();
    consumer?.cleanup();
    provider = null;
    consumer = null;
    delete (globalThis as Record<string, unknown>).__consumerHandle;
    clearServiceRegistry();
    pluginEvents.clear();
  });

  async function activateBoth(
    consumerRequires?: Array<Record<string, unknown>>,
  ) {
    provider = providerFixture();
    callLog = path.join(provider.root, "calls.txt");
    fs.writeFileSync(
      path.join(provider.dir, "backend", "index.mjs"),
      providerSource(callLog),
    );

    consumer = consumerRequires
      ? consumerFixture(consumerRequires)
      : consumerFixture();

    loader = new PluginLoader();
    const providerPlugin = await loader.load(provider.dir);
    await loader.activate(providerPlugin.id);

    const consumerPlugin = await loader.load(consumer.dir);
    await loader.activate(consumerPlugin.id);

    return { providerPlugin, consumerPlugin };
  }

  function providerCallCount(): number {
    if (!fs.existsSync(callLog)) return 0;
    return fs.readFileSync(callLog, "utf8").trim().split("\n").filter(Boolean)
      .length;
  }

  it("resolves structurally when both plugins are active", async () => {
    const { providerPlugin, consumerPlugin } = await activateBoth();

    expect(providerPlugin.state).toBe("active");
    expect(consumerPlugin.state).toBe("active");

    const registration = getRegistration(SERVICE);
    expect(registration?.version).toBe("1.2.0");
    expect(registration?.pluginId).toBe("ssh-terminal");
    expect(registration?.permission).toBe(PERMISSION);
  });

  it("fails activation when a hard requirement is unsatisfied", async () => {
    consumer = consumerFixture([{ service: SERVICE, versionRange: "^9.0.0" }]);

    loader = new PluginLoader();
    const plugin = await loader.load(consumer.dir);

    await expect(loader.activate(plugin.id)).rejects.toThrow(
      /no active plugin provides|provides 1\.2\.0/,
    );
    expect(plugin.state).toBe("failed");
  });

  it("activates anyway when an unsatisfied requirement is optional", async () => {
    consumer = consumerFixture([
      { service: "testplugin.absent", versionRange: "^1.0.0", optional: true },
    ]);

    loader = new PluginLoader();
    const plugin = await loader.load(consumer.dir);
    await loader.activate(plugin.id);

    expect(plugin.state).toBe("active");
  });

  it("allows a call from a user who holds the permission", async () => {
    await activateBoth();

    await expect(handle().asUser("alice").hello("world")).resolves.toBe(
      "hello world",
    );
    expect(providerCallCount()).toBe(1);

    const entry = state.auditEntries.at(-1);
    expect(entry?.success).toBe(true);
    expect(entry?.username).toBe("plugin:docker");
    expect(entry?.userId).toBe("alice");
    expect(entry?.action).toBe("plugin_service_testplugin_greet_hello");
    expect(entry?.resourceId).toBe("ssh-terminal");
  });

  it("denies a user without the permission, with the standard shape", async () => {
    await activateBoth();
    state.granted.delete(PERMISSION);

    await handle()
      .asUser("mallory")
      .hello("world")
      .then(
        () => expect.unreachable("should have been denied"),
        (error: InstanceType<typeof PluginServicePermissionError>) => {
          expect(error.name).toBe("PluginServicePermissionError");
          expect(error.status).toBe(403);
          expect(error.body).toEqual({
            error: "Insufficient permissions",
            required: PERMISSION,
          });
          expect(error.message).toContain("do not have access");
        },
      );

    // The gate runs before delegation: the provider never saw the call.
    expect(providerCallCount()).toBe(0);

    const entry = state.auditEntries.at(-1);
    expect(entry?.success).toBe(false);
    expect(entry?.userId).toBe("mallory");
    expect(String(entry?.errorMessage)).toContain(PERMISSION);
  });

  it("honours a revoke mid-session on the very next call", async () => {
    await activateBoth();
    const live = handle().asUser("alice");

    await expect(live.hello("first")).resolves.toBe("hello first");

    // No restart, no reinstall, same handle: the check is per call, which is
    // exactly why it lives in the proxy rather than at handle creation.
    state.granted.delete(PERMISSION);

    await expect(live.hello("second")).rejects.toThrow(
      PluginServicePermissionError,
    );
    expect(providerCallCount()).toBe(1);

    // And granting it back takes effect just as immediately.
    state.granted.add(PERMISSION);
    await expect(live.hello("third")).resolves.toBe("hello third");
    expect(providerCallCount()).toBe(2);
  });

  it("surfaces a clear error once the provider is deactivated, without tearing the consumer down", async () => {
    const { consumerPlugin } = await activateBoth();
    const live = handle().asUser("alice");

    await expect(live.hello("before")).resolves.toBe("hello before");

    await loader!.deactivate("ssh-terminal");

    expect(getRegistration(SERVICE)).toBeUndefined();

    // Documented behaviour: the consumer stays active and decides for itself
    // what to do. Deactivating one plugin must not silently stop others.
    expect(consumerPlugin.state).toBe("active");

    let thrown: unknown;
    try {
      await live.hello("after");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PluginServiceUnavailableError);
    expect((thrown as { code: string }).code).toBe("EPLUGINSVCGONE");
    expect((thrown as Error).message).toContain(SERVICE);
    expect(providerCallCount()).toBe(1);
  });

  it("refuses to provide a service the manifest never declared", async () => {
    provider = createFixturePlugin({
      id: "ssh-terminal",
      capabilities: ["kv:own"],
      backendSource: `
export async function activate(ctx) {
  ctx.services.provide("testplugin.undeclared", { hello: async () => "hi" });
}
`,
      manifestOverrides: { category: "Terminal" },
    });

    loader = new PluginLoader();
    const plugin = await loader.load(provider.dir);

    await expect(loader.activate(plugin.id)).rejects.toThrow(
      /not declared in the manifest's provides array/,
    );
  });
});
