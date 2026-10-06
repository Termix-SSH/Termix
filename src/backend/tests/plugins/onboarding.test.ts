/**
 * The onboarding plugin picker, against a real PluginLoader and fixture
 * plugins on disk. The database is faked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFixturePlugin } from "./fixture-plugin.js";
import type { LoadedPlugin } from "../../plugins/loader.js";

const db = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  settings: new Map<string, string>(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    listAll: async () => [...db.rows.values()],
    findById: async (id: string) => db.rows.get(id) ?? null,
    update: async (id: string, input: Record<string, unknown>) => {
      const row = db.rows.get(id);
      if (!row) return null;
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) row[key] = value;
      }
      return row;
    },
    delete: async (id: string) => db.rows.delete(id),
  }),
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => db.settings.get(key) ?? null,
    set: async (key: string, value: string) => void db.settings.set(key, value),
    delete: async (key: string) => void db.settings.delete(key),
  }),
  createCurrentPluginStorageRepository: () => ({
    get: async () => null,
    set: async () => {},
    delete: async () => false,
    listKeys: async () => [],
    countKeys: async () => 0,
  }),
}));

vi.mock("../../plugins/data.js", () => ({
  migratePlugin: async () => [],
  removePluginData: async () => ({ tables: [], kvKeys: 0, migrations: 0 }),
  describePluginTables: async () => [],
  registerTable: () => ({}),
  forgetTables: () => {},
}));

vi.mock("../../plugins/permissions.js", () => ({
  invalidatePluginPermissionCache: () => {},
}));

vi.mock("../../plugins/index.js", async () => {
  const { PluginLoader } = await import("../../plugins/loader.js");
  const loader = new PluginLoader();
  return {
    getPluginRuntime: () => ({ loader }),
    activatePlugin: (id: string) => loader.activate(id),
    deactivatePlugin: (id: string) => loader.deactivate(id),
    registerLoadedPlugins: async (plugins: LoadedPlugin[]) => {
      for (const plugin of plugins) {
        db.rows.set(plugin.id, {
          id: plugin.id,
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          source: plugin.source,
          state: "enabled",
          lastError: null,
          pinnedVersion: null,
          manifestJson: JSON.stringify(plugin.manifest),
        });
      }
    },
    unloadPlugin: async () => {},
  };
});

const { getPluginRuntime, registerLoadedPlugins } =
  await import("../../plugins/index.js");
const manage = await import("../../plugins/manage.js");
const onboarding = await import("../../plugins/onboarding.js");
const { resetBundledIndexCache } =
  await import("../../plugins/bundled-index.js");

const roots: string[] = [];
let bundled: string;
let data: string;

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function writeIndex(plugins: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(bundled, "bundled-index.json"),
    JSON.stringify({ version: 1, plugins }),
  );
  resetBundledIndexCache();
}

async function chain() {
  createFixturePlugin({ id: "base", root: bundled });
  createFixturePlugin({
    id: "addon",
    root: bundled,
    manifestOverrides: { dependencies: { base: "^1.0.0" } },
  });
  createFixturePlugin({ id: "extra", root: bundled });
  const { loader } = getPluginRuntime();
  await manage.applyStoredPluginChoices(loader);
  const loaded = await loader.loadAll();
  await registerLoadedPlugins(loaded);
  for (const plugin of loaded) await loader.activate(plugin.id);
  return loader;
}

beforeEach(() => {
  bundled = tempRoot("termix-bundled-");
  data = tempRoot("termix-data-");
  process.env.TERMIX_BUNDLED_PLUGINS_DIR = bundled;
  process.env.DATA_DIR = data;
  db.rows.clear();
  db.settings.clear();
  resetBundledIndexCache();
});

afterEach(async () => {
  const { loader } = getPluginRuntime();
  await loader.shutdown();
  for (const plugin of loader.list()) loader.forget(plugin.id);
  delete process.env.TERMIX_BUNDLED_PLUGINS_DIR;
  delete process.env.DATA_DIR;
  while (roots.length) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe("offerPluginSetup", () => {
  it("offers the picker once, as fresh or as an upgrade", async () => {
    await onboarding.offerPluginSetup(false);
    expect(db.settings.get(onboarding.PLUGIN_SETUP_PENDING_KEY)).toBe(
      "upgrade",
    );
    expect(await onboarding.pluginSetupReason()).toBe("upgrade");

    db.settings.delete(onboarding.PLUGIN_SETUP_PENDING_KEY);
    await onboarding.offerPluginSetup(true);
    expect(await onboarding.isPluginSetupPending()).toBe(false);
  });

  it("marks a fresh install", async () => {
    await onboarding.offerPluginSetup(true);
    expect(await onboarding.pluginSetupReason()).toBe("fresh");
  });

  it("is not offered again after the picker was applied", async () => {
    await chain();
    await onboarding.offerPluginSetup(false);
    await onboarding.applyOnboardingChoices({});
    db.settings.delete(onboarding.PLUGIN_SETUP_OFFERED_KEY);
    await onboarding.applyOnboardingChoices({});
    await onboarding.offerPluginSetup(false);
    expect(await onboarding.isPluginSetupPending()).toBe(false);
  });
});

describe("describeOnboardingPlugins", () => {
  it("lists installed plugins with their defaults and the pending flag", async () => {
    writeIndex({
      base: { onboarding: { recommended: true } },
      extra: { onboarding: { recommended: true, consent: true } },
    });
    await chain();
    db.settings.set(onboarding.PLUGIN_SETUP_PENDING_KEY, "1");

    const list = await onboarding.describeOnboardingPlugins();
    expect(list.pending).toBe(true);
    expect(list.reason).toBe("fresh");
    expect(list.managedByLinkedServer).toBe(false);
    const byId = Object.fromEntries(list.plugins.map((p) => [p.id, p]));
    expect(byId.base).toMatchObject({
      recommended: true,
      consent: false,
      source: "bundled",
      state: "enabled",
    });
    expect(byId.addon).toMatchObject({
      recommended: false,
      dependencies: ["base"],
    });
    expect(byId.extra).toMatchObject({ recommended: true, consent: true });
  });
});

describe("applyOnboardingChoices", () => {
  it("enables, disables and removes, then clears the pending flag", async () => {
    const loader = await chain();
    db.rows.get("extra")!.state = "disabled";
    await loader.deactivate("extra");
    db.settings.set(onboarding.PLUGIN_SETUP_PENDING_KEY, "1");

    const result = await onboarding.applyOnboardingChoices({
      base: "disabled",
      addon: "remove",
      extra: "enabled",
    });

    expect(result.failed).toEqual([]);
    expect(result.enabled).toEqual(["extra"]);
    expect(result.disabled).toEqual(["base"]);
    expect(result.removed).toEqual(["addon"]);
    expect(loader.get("addon")).toBeUndefined();
    expect(loader.get("base")?.state).toBe("stopped");
    expect(loader.get("extra")?.state).toBe("active");
    expect(JSON.parse(db.settings.get("plugins_uninstalled")!)).toEqual([
      "addon",
    ]);
    expect(db.settings.has(onboarding.PLUGIN_SETUP_PENDING_KEY)).toBe(false);
  });

  it("keeps a dependency that a kept plugin still needs", async () => {
    const loader = await chain();
    const result = await onboarding.applyOnboardingChoices({
      base: "remove",
      addon: "disabled",
    });
    expect(result.adjustments).toEqual([
      { id: "base", from: "remove", to: "disabled", requiredBy: ["addon"] },
    ]);
    expect(result.removed).toEqual([]);
    expect(loader.get("base")?.state).toBe("stopped");
    expect(loader.get("addon")?.state).toBe("stopped");
  });

  it("removes dependents before what they depend on", async () => {
    const loader = await chain();
    const result = await onboarding.applyOnboardingChoices({
      base: "remove",
      addon: "remove",
    });
    expect(result.failed).toEqual([]);
    expect(result.removed).toEqual(["addon", "base"]);
    expect(loader.get("base")).toBeUndefined();
  });

  it("changes nothing on a dry run", async () => {
    const loader = await chain();
    db.settings.set(onboarding.PLUGIN_SETUP_PENDING_KEY, "1");
    const result = await onboarding.applyOnboardingChoices(
      { extra: "remove", base: "disabled", addon: "disabled" },
      { dryRun: true },
    );
    expect(result.removed).toEqual(["extra"]);
    expect(result.disabled).toEqual(["addon", "base"]);
    expect(loader.get("extra")?.state).toBe("active");
    expect(db.settings.get(onboarding.PLUGIN_SETUP_PENDING_KEY)).toBe("1");
  });

  it("ignores ids that are not installed", async () => {
    await chain();
    const result = await onboarding.applyOnboardingChoices({
      ghost: "remove",
    });
    expect(result.resolved).toEqual({});
    expect(result.removed).toEqual([]);
  });

  it("waits for a plugin change already in progress", async () => {
    const loader = await chain();
    const first = manage.setPluginState("extra", false);
    const second = onboarding.applyOnboardingChoices({ extra: "enabled" });
    await first;
    const result = await second;
    expect(result.enabled).toEqual(["extra"]);
    expect(loader.get("extra")?.state).toBe("active");
  });
});
