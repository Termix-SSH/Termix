/**
 * Two real plugins on disk, one offering a secret and one borrowing it, driven
 * through the actual PluginLoader.
 *
 * The secret ("api-key") and the permission gating it
 * ("testplugin.secrets.share") are fixture-owned, so nothing about the
 * shipped plugins is under test even though the fixtures borrow their ids.
 *
 * What the unit test cannot show, and this does: that the manifest declaration
 * is enforced by the real ctx, and that a genuine uninstall through
 * loader.deactivate() leaves the borrower with null rather than a handle onto
 * a resolver whose plugin is gone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Fixture } from "./fixture-plugin.js";

const state = vi.hoisted(() => ({
  /** Permissions the acting user currently holds. Mutated mid-test. */
  granted: new Set<string>(),
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
  clearSecretRegistry,
  getSecretRegistration,
  PluginSecretPermissionError,
  PluginSecretUndeclaredError,
} = await import("../../plugins/secret-registry.js");
const { pluginEvents } = await import("../../plugins/events.js");
const { createFixturePlugin } = await import("./fixture-plugin.js");

const PROVIDER_ID = "ssh-terminal";
const CONSUMER_ID = "docker";
const KEY = "api-key";
// Registered as <pluginId>.<name>, so it carries the provider fixture id.
const PERMISSION = "ssh-terminal.secrets.share";
const SECRET = "sk-fixture-value";

/**
 * The provider offers a resolver reading the current value from a file, so the
 * test can rotate or clear it from outside without restarting the plugin. A
 * module-level variable would not work: the plugin is imported by URL and
 * lives in its own ESM module instance.
 */
function providerSource(valueFile: string): string {
  const literal = JSON.stringify(valueFile);
  return `
import fs from "node:fs";
export async function activate(ctx) {
  ctx.secrets.offer(${JSON.stringify(KEY)}, async () => {
    if (!fs.existsSync(${literal})) return null;
    const value = fs.readFileSync(${literal}, "utf8");
    return value.length > 0 ? value : null;
  });
}
`;
}

/**
 * The consumer stashes a bound read on globalThis so the test can invoke it as
 * a specific user afterwards. Note it stashes a FUNCTION, not a value: there
 * is no handle to hold, which is the property under test.
 */
const CONSUMER_SOURCE = `
export async function activate(ctx) {
  globalThis.__borrow = (userId) =>
    ctx.secrets.getShared(${JSON.stringify(PROVIDER_ID)}, ${JSON.stringify(KEY)}, { userId });
  globalThis.__borrowUndeclared = (userId) =>
    ctx.secrets.getShared(${JSON.stringify(PROVIDER_ID)}, "not-declared", { userId });
}
`;

function providerFixture(): Fixture {
  return createFixturePlugin({
    id: PROVIDER_ID,
    capabilities: ["kv:own"],
    manifestOverrides: {
      category: "Terminal",
      providesSecret: [{ key: KEY, permission: PERMISSION }],
      contributes: {
        permissions: [
          {
            name: "secrets.share",
            titleKey: "permissions.secrets.share.title",
            descriptionKey: "permissions.secrets.share.description",
          },
        ],
      },
    },
  });
}

function consumerFixture(
  requiresSecret: Array<Record<string, unknown>> = [
    { plugin: PROVIDER_ID, key: KEY, optional: true },
  ],
): Fixture {
  return createFixturePlugin({
    id: CONSUMER_ID,
    capabilities: ["kv:own"],
    backendSource: CONSUMER_SOURCE,
    manifestOverrides: { category: "Infrastructure", requiresSecret },
  });
}

function borrow(userId = "user-1"): Promise<string | null> {
  const fn = (globalThis as Record<string, unknown>).__borrow as (
    id: string,
  ) => Promise<string | null>;
  return fn(userId);
}

function borrowUndeclared(userId = "user-1"): Promise<string | null> {
  const fn = (globalThis as Record<string, unknown>).__borrowUndeclared as (
    id: string,
  ) => Promise<string | null>;
  return fn(userId);
}

describe("cross-plugin secret references", () => {
  let provider: Fixture | null = null;
  let consumer: Fixture | null = null;
  let loader: InstanceType<typeof PluginLoader> | null = null;
  let valueFile = "";

  beforeEach(() => {
    state.granted = new Set([PERMISSION]);
    state.auditEntries = [];
    clearSecretRegistry();
    pluginEvents.clear();
  });

  afterEach(async () => {
    await loader?.shutdown();
    loader = null;
    provider?.cleanup();
    consumer?.cleanup();
    provider = null;
    consumer = null;
    delete (globalThis as Record<string, unknown>).__borrow;
    delete (globalThis as Record<string, unknown>).__borrowUndeclared;
    clearSecretRegistry();
    pluginEvents.clear();
  });

  async function activateProvider() {
    provider = providerFixture();
    valueFile = path.join(provider.root, "secret.txt");
    fs.writeFileSync(valueFile, SECRET);
    fs.writeFileSync(
      path.join(provider.dir, "backend", "index.mjs"),
      providerSource(valueFile),
    );

    loader ??= new PluginLoader();
    const plugin = await loader.load(provider.dir);
    await loader.activate(plugin.id);
    return plugin;
  }

  async function activateConsumer(
    requiresSecret?: Array<Record<string, unknown>>,
  ) {
    consumer = requiresSecret
      ? consumerFixture(requiresSecret)
      : consumerFixture();

    loader ??= new PluginLoader();
    const plugin = await loader.load(consumer.dir);
    await loader.activate(plugin.id);
    return plugin;
  }

  async function activateBoth() {
    loader = new PluginLoader();
    const providerPlugin = await activateProvider();
    const consumerPlugin = await activateConsumer();
    return { providerPlugin, consumerPlugin };
  }

  it("registers the offer when the provider activates", async () => {
    const { providerPlugin, consumerPlugin } = await activateBoth();

    expect(providerPlugin.state).toBe("active");
    expect(consumerPlugin.state).toBe("active");

    const registration = getSecretRegistration(PROVIDER_ID, KEY);
    expect(registration?.pluginId).toBe(PROVIDER_ID);
    expect(registration?.permission).toBe(PERMISSION);
  });

  it("resolves for a user who holds the permission", async () => {
    await activateBoth();

    await expect(borrow()).resolves.toBe(SECRET);
  });

  it("denies a user without the permission, though the secret is set", async () => {
    await activateBoth();
    state.granted = new Set();

    await expect(borrow("user-2")).rejects.toBeInstanceOf(
      PluginSecretPermissionError,
    );
    // Still installed, still set: the difference is purely this user's role.
    expect(getSecretRegistration(PROVIDER_ID, KEY)).toBeDefined();
    expect(fs.readFileSync(valueFile, "utf8")).toBe(SECRET);
  });

  it("lets one user borrow while another is denied, with no reinstall", async () => {
    await activateBoth();

    // The grant is per-user, so both answers come from the same live install.
    await expect(borrow("allowed-user")).resolves.toBe(SECRET);

    state.granted = new Set();
    await expect(borrow("denied-user")).rejects.toBeInstanceOf(
      PluginSecretPermissionError,
    );

    state.granted = new Set([PERMISSION]);
    await expect(borrow("allowed-user")).resolves.toBe(SECRET);
  });

  it("returns null when the provider is installed but the key is not set", async () => {
    await activateBoth();
    fs.writeFileSync(valueFile, "");

    await expect(borrow()).resolves.toBeNull();
  });

  it("returns null when the providing plugin was never installed", async () => {
    loader = new PluginLoader();
    await activateConsumer();

    // The consumer activates regardless: the reference is resolved per call.
    await expect(borrow()).resolves.toBeNull();
  });

  it("activates the consumer even when a non-optional reference is absent", async () => {
    loader = new PluginLoader();
    const plugin = await activateConsumer([{ plugin: PROVIDER_ID, key: KEY }]);

    // Unlike a service requirement, an absent secret provider is recoverable
    // by installing it later, so it must not be a hard ordering dependency.
    expect(plugin.state).toBe("active");
    await expect(borrow()).resolves.toBeNull();
  });

  it("refuses a read the consumer's manifest never declared", async () => {
    await activateBoth();

    await expect(borrowUndeclared()).rejects.toBeInstanceOf(
      PluginSecretUndeclaredError,
    );
  });

  it("refuses to offer a secret the provider's manifest never declared", async () => {
    provider = createFixturePlugin({
      id: PROVIDER_ID,
      capabilities: ["kv:own"],
      backendSource: `
export async function activate(ctx) {
  ctx.secrets.offer("undeclared-key", () => "nope");
}
`,
      manifestOverrides: {
        category: "Terminal",
        providesSecret: [{ key: KEY, permission: PERMISSION }],
        contributes: {
          permissions: [
            {
              name: "secrets.share",
              titleKey: "permissions.secrets.share.title",
              descriptionKey: "permissions.secrets.share.description",
            },
          ],
        },
      },
    });

    loader = new PluginLoader();
    const plugin = await loader.load(provider.dir);
    await loader.activate(plugin.id).catch(() => undefined);

    expect(plugin.state).not.toBe("active");
    expect(
      getSecretRegistration(PROVIDER_ID, "undeclared-key"),
    ).toBeUndefined();
  });

  describe("the provider stays in control", () => {
    it("serves a rotated value on the next borrow", async () => {
      await activateBoth();
      await expect(borrow()).resolves.toBe(SECRET);

      fs.writeFileSync(valueFile, "sk-fixture-rotated");

      // Nothing to invalidate: the borrower never held a copy to go stale.
      await expect(borrow()).resolves.toBe("sk-fixture-rotated");
    });

    it("nulls the borrow out when the provider clears the secret", async () => {
      await activateBoth();
      await expect(borrow()).resolves.toBe(SECRET);

      fs.rmSync(valueFile);

      await expect(borrow()).resolves.toBeNull();
    });
  });

  describe("uninstalling the provider", () => {
    it("nulls out the reference rather than leaving a dangling handle", async () => {
      const { providerPlugin } = await activateBoth();
      await expect(borrow()).resolves.toBe(SECRET);

      await loader!.deactivate(providerPlugin.id);

      // The borrower is untouched: still active, still permitted, still
      // declaring the reference. It just gets null now, and does not throw.
      expect(getSecretRegistration(PROVIDER_ID, KEY)).toBeUndefined();
      await expect(borrow()).resolves.toBeNull();
    });

    it("keeps serving nothing even though the underlying value still exists", async () => {
      const { providerPlugin } = await activateBoth();
      await loader!.deactivate(providerPlugin.id);

      // The file is still on disk. Access went away with the plugin that
      // mediated it, which is the point: there was never a copy to fall back on.
      expect(fs.readFileSync(valueFile, "utf8")).toBe(SECRET);
      await expect(borrow()).resolves.toBeNull();
    });

    it("resumes when the provider is reinstalled, with no borrower restart", async () => {
      const { providerPlugin } = await activateBoth();
      await loader!.deactivate(providerPlugin.id);
      await expect(borrow()).resolves.toBeNull();

      await loader!.activate(providerPlugin.id);

      await expect(borrow()).resolves.toBe(SECRET);
    });
  });

  describe("audit", () => {
    it("records a borrow without the value", async () => {
      await activateBoth();
      await borrow("user-9");

      const entry = state.auditEntries.at(-1);
      expect(entry).toMatchObject({
        userId: "user-9",
        username: `plugin:${CONSUMER_ID}`,
        action: "plugin_secret_shared_read",
        resourceId: PROVIDER_ID,
        success: true,
      });
      expect(JSON.stringify(state.auditEntries)).not.toContain(SECRET);
    });

    it("records a denial without the value", async () => {
      await activateBoth();
      state.granted = new Set();
      await borrow().catch(() => undefined);

      expect(state.auditEntries.at(-1)).toMatchObject({ success: false });
      expect(JSON.stringify(state.auditEntries)).not.toContain(SECRET);
    });
  });
});
