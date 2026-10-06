/**
 * Install, update, uninstall and switching, against a real PluginLoader and
 * fixture plugins on disk. The database and the registry are faked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { createFixturePlugin } from "./fixture-plugin.js";
import type { LoadedPlugin } from "../../plugins/loader.js";

interface Row {
  id: string;
  name: string;
  version: string;
  tier: string;
  source: string;
  state: string;
  lastError: string | null;
  registryId: string | null;
  autoUpdate: boolean;
  pinnedVersion: string | null;
  manifestJson: string;
}

const db = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  settings: new Map<string, string>(),
  grants: [] as Array<{ pluginId: string; capability: string }>,
}));

const registry = vi.hoisted(() => ({
  index: { registry: "official", name: "", plugins: [] as unknown[] },
  download: vi.fn(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    listAll: async () => [...db.rows.values()],
    findById: async (id: string) => db.rows.get(id) ?? null,
    create: async (input: Record<string, unknown>) => {
      const row = {
        registryId: null,
        lastError: null,
        autoUpdate: false,
        pinnedVersion: null,
        ...input,
      };
      db.rows.set(input.id as string, row);
      return row;
    },
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
  }),
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async (id: string) =>
      db.grants.filter((g) => g.pluginId === id),
    grant: async (input: { pluginId: string; capability: string }) =>
      void db.grants.push(input),
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

vi.mock("../../plugins/registry-index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../plugins/registry-index.js")>();
  return {
    ...actual,
    fetchRegistryIndex: async () => actual.parseRegistryIndex(registry.index),
    downloadRelease: registry.download,
  };
});

vi.mock("../../plugins/index.js", async () => {
  const { PluginLoader } = await import("../../plugins/loader.js");
  const loader = new PluginLoader();
  const seed = async (plugins: LoadedPlugin[]) => {
    for (const plugin of plugins) {
      if (db.rows.has(plugin.id)) {
        Object.assign(db.rows.get(plugin.id)!, {
          version: plugin.manifest.version,
          manifestJson: JSON.stringify(plugin.manifest),
        });
        continue;
      }
      db.rows.set(plugin.id, {
        id: plugin.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        tier: plugin.source === "bundled" ? "bundled" : "community",
        source: plugin.source,
        state: plugin.source === "bundled" ? "enabled" : "disabled",
        lastError: null,
        registryId: null,
        autoUpdate: false,
        pinnedVersion: null,
        manifestJson: JSON.stringify(plugin.manifest),
      } satisfies Row);
    }
  };
  return {
    getPluginRuntime: () => ({ loader }),
    activatePlugin: (id: string) => loader.activate(id),
    deactivatePlugin: (id: string) => loader.deactivate(id),
    registerLoadedPlugins: seed,
    unloadPlugin: async (id: string) => {
      if (!loader.get(id)) return;
      await loader.deactivate(id);
      loader.forget(id);
    },
  };
});

const { getPluginRuntime } = await import("../../plugins/index.js");
const manage = await import("../../plugins/manage.js");

const roots: string[] = [];
let bundled: string;
let data: string;

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

const DEFAULT_CAPS = ["hosts:read", "kv:own"];

function registryEntry(
  id: string,
  versions: Array<{ version: string; capabilities?: string[] }>,
) {
  return {
    id,
    name: id,
    versions: versions.map((v) => ({
      version: v.version,
      api: "1",
      url: `https://example.com/${id}-${v.version}.tmxplug`,
      sha256: "a".repeat(64),
      signature: "sig",
      size: 1,
      capabilities: v.capabilities ?? ["hosts:read", "kv:own"],
    })),
  };
}

/** A .tmxplug of a fixture plugin, standing in for a verified download. */
async function stageArtifact(
  id: string,
  manifestOverrides: Record<string, unknown> = {},
) {
  const build = tempRoot("termix-build-");
  createFixturePlugin({ id, root: build, manifestOverrides });
  const staging = path.join(data, "plugins", ".downloads");
  fs.mkdirSync(staging, { recursive: true });
  const file = path.join(staging, `${id}-staged.tmxplug`);
  await tar.c({ gzip: true, file, cwd: path.join(build, id) }, ["."]);
  return { file, signatureFile: `${file}.sig` };
}

async function boot() {
  const { loader } = getPluginRuntime();
  await manage.applyStoredPluginChoices(loader);
  const loaded = await loader.loadAll();
  const { registerLoadedPlugins } = await import("../../plugins/index.js");
  await registerLoadedPlugins(loaded);
  for (const plugin of loaded) {
    if (db.rows.get(plugin.id)?.state === "enabled") {
      await loader.activate(plugin.id);
    }
  }
  return loader;
}

beforeEach(() => {
  bundled = tempRoot("termix-bundled-");
  data = tempRoot("termix-data-");
  process.env.TERMIX_BUNDLED_PLUGINS_DIR = bundled;
  process.env.DATA_DIR = data;
  db.rows.clear();
  db.settings.clear();
  db.grants.length = 0;
  registry.index.plugins = [];
  registry.download.mockReset();
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

describe("uninstall and reinstall of a bundled plugin", () => {
  it("deletes it, keeps it gone after a restart, and downloads it again", async () => {
    createFixturePlugin({ id: "docker", root: bundled });
    registry.index.plugins = [registryEntry("docker", [{ version: "1.0.0" }])];
    let loader = await boot();
    expect(loader.get("docker")?.state).toBe("active");

    await manage.uninstallPlugin("docker");
    expect(loader.get("docker")).toBeUndefined();
    expect(db.rows.has("docker")).toBe(false);
    expect(fs.existsSync(path.join(bundled, "docker"))).toBe(false);
    expect(JSON.parse(db.settings.get("plugins_uninstalled")!)).toEqual([
      "docker",
    ]);

    await loader.shutdown();
    for (const plugin of loader.list()) loader.forget(plugin.id);
    // A recreated container brings the image's copy back; it stays ignored.
    createFixturePlugin({ id: "docker", root: bundled });
    loader = await boot();
    expect(loader.get("docker")).toBeUndefined();

    registry.download.mockImplementation(() => stageArtifact("docker"));
    const result = await manage.installPlugin("docker", {
      userId: "admin",
      capabilities: DEFAULT_CAPS,
    });
    expect(result.state).toBe("active");
    expect(registry.download).toHaveBeenCalledOnce();
    expect(loader.get("docker")?.source).toBe("user");
    expect(fs.existsSync(path.join(data, "plugins", "docker.tmxplug"))).toBe(
      true,
    );
    expect(db.rows.get("docker")).toMatchObject({
      registryId: "official",
      tier: "official",
    });
    expect(db.grants.map((g) => g.capability)).toEqual([
      "hosts:read",
      "kv:own",
    ]);

    await loader.shutdown();
    for (const plugin of loader.list()) loader.forget(plugin.id);
    loader = await boot();
    expect(loader.get("docker")?.source).toBe("user");
  });

  it("deletes a plugin dropped in as a plain folder", async () => {
    createFixturePlugin({ id: "notes", root: path.join(data, "plugins") });
    const loader = await boot();
    expect(loader.get("notes")?.source).toBe("user");

    await manage.uninstallPlugin("notes");
    expect(fs.existsSync(path.join(data, "plugins", "notes"))).toBe(false);
    expect(fs.existsSync(path.join(data, "plugins"))).toBe(true);
    expect(db.settings.get("plugins_uninstalled")).toBeUndefined();
  });

  it("refuses to install something already installed", async () => {
    createFixturePlugin({ id: "docker", root: bundled });
    registry.index.plugins = [registryEntry("docker", [{ version: "1.0.0" }])];
    await boot();
    await expect(
      manage.installPlugin("docker", { userId: "admin" }),
    ).rejects.toMatchObject({ code: "ALREADY_INSTALLED" });
  });
});

describe("installing from the registry", () => {
  it("puts the artifact in place, grants what it declares and starts it", async () => {
    registry.index.plugins = [registryEntry("notes", [{ version: "1.0.0" }])];
    registry.download.mockImplementation(() =>
      stageArtifact("notes", { capabilities: ["kv:own"] }),
    );
    const loader = await boot();

    const result = await manage.installPlugin("notes", {
      userId: "admin",
      capabilities: DEFAULT_CAPS,
    });

    expect(result).toMatchObject({ id: "notes", state: "active" });
    expect(fs.existsSync(path.join(data, "plugins", "notes.tmxplug"))).toBe(
      true,
    );
    expect(loader.get("notes")?.source).toBe("user");
    expect(db.rows.get("notes")?.tier).toBe("official");
    expect(db.grants).toEqual([
      expect.objectContaining({ pluginId: "notes", capability: "kv:own" }),
    ]);
  });

  it("refuses a plugin that is not in the registry", async () => {
    await boot();
    await expect(
      manage.installPlugin("nope", { userId: "admin" }),
    ).rejects.toMatchObject({ code: "NOT_IN_REGISTRY" });
  });

  it("pins an explicitly picked older version", async () => {
    registry.index.plugins = [
      registryEntry("notes", [{ version: "1.1.0" }, { version: "1.0.0" }]),
    ];
    registry.download.mockImplementation(() => stageArtifact("notes"));
    await boot();

    await manage.installPlugin("notes", {
      userId: "admin",
      version: "1.0.0",
      capabilities: DEFAULT_CAPS,
    });
    expect(db.rows.get("notes")?.pinnedVersion).toBe("1.0.0");
  });

  it("uninstalls a registry plugin and its files", async () => {
    registry.index.plugins = [registryEntry("notes", [{ version: "1.0.0" }])];
    registry.download.mockImplementation(() => stageArtifact("notes"));
    await boot();
    await manage.installPlugin("notes", {
      userId: "admin",
      capabilities: DEFAULT_CAPS,
    });

    await manage.uninstallPlugin("notes");
    expect(fs.existsSync(path.join(data, "plugins", "notes.tmxplug"))).toBe(
      false,
    );
    expect(db.rows.has("notes")).toBe(false);
    expect(db.settings.get("plugins_uninstalled")).toBeUndefined();
  });
});

describe("updates", () => {
  it("waits for consent when a release asks for new capabilities", async () => {
    createFixturePlugin({ id: "docker", root: bundled });
    registry.index.plugins = [
      registryEntry("docker", [
        {
          version: "1.1.0",
          capabilities: ["hosts:read", "kv:own", "notify:send"],
        },
        { version: "1.0.0" },
      ]),
    ];
    await boot();

    await expect(
      manage.updatePlugin("docker", { userId: "admin" }),
    ).rejects.toMatchObject({
      code: "CAPABILITIES_ADDED",
      details: { capabilities: ["notify:send"] },
    });
    expect(registry.download).not.toHaveBeenCalled();
  });

  it("lists an update and skips it in update-all when pinned", async () => {
    createFixturePlugin({ id: "docker", root: bundled });
    registry.index.plugins = [
      registryEntry("docker", [{ version: "1.1.0" }, { version: "1.0.0" }]),
    ];
    await boot();

    const listing = await manage.listRegistry();
    expect(listing.plugins[0]).toMatchObject({
      installed: true,
      installedVersion: "1.0.0",
      latestVersion: "1.1.0",
      updateAvailable: true,
      addedCapabilities: [],
      bundled: true,
    });

    await manage.setPluginOptions("docker", { pinned: true });
    const result = await manage.updateAllPlugins({ userId: "admin" });
    expect(result.updated).toEqual([]);
    expect(registry.download).not.toHaveBeenCalled();
  });
});

describe("dependencies", () => {
  it("starts a dependency first and stops dependents first", async () => {
    createFixturePlugin({ id: "base", root: bundled });
    createFixturePlugin({
      id: "addon",
      root: bundled,
      manifestOverrides: { dependencies: { base: "^1.0.0" } },
    });
    const loader = await boot();

    const off = await manage.setPluginState("base", false);
    expect(off.disable).toEqual(["addon"]);
    expect(loader.get("addon")?.state).toBe("stopped");
    expect(loader.get("base")?.state).toBe("stopped");

    const plan = await manage.planStateChange("addon", true);
    expect(plan.enable).toEqual(["base"]);
    const on = await manage.setPluginState("addon", true);
    expect(on.state).toBe("active");
    expect(loader.get("base")?.state).toBe("active");
  });

  it("refuses to uninstall a plugin a running one depends on", async () => {
    createFixturePlugin({ id: "base", root: bundled });
    createFixturePlugin({
      id: "addon",
      root: bundled,
      manifestOverrides: { dependencies: { base: "^1.0.0" } },
    });
    await boot();

    await expect(manage.uninstallPlugin("base")).rejects.toMatchObject({
      code: "HAS_DEPENDENTS",
      details: { dependents: ["addon"] },
    });
  });
});

describe("consent", () => {
  it("refuses an install without the consented list, before any download", async () => {
    registry.index.plugins = [registryEntry("notes", [{ version: "1.0.0" }])];
    await boot();
    await expect(
      manage.installPlugin("notes", { userId: "admin" }),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    expect(registry.download).not.toHaveBeenCalled();
  });

  it("refuses when the consent does not match what the release asks for", async () => {
    registry.index.plugins = [
      registryEntry("notes", [
        { version: "1.0.0", capabilities: ["kv:own", "credentials:read"] },
      ]),
    ];
    await boot();
    await expect(
      manage.installPlugin("notes", {
        userId: "admin",
        capabilities: ["kv:own"],
      }),
    ).rejects.toMatchObject({
      code: "CONSENT_MISMATCH",
      details: { capabilities: ["kv:own", "credentials:read"] },
    });
    expect(registry.download).not.toHaveBeenCalled();
    expect(db.rows.has("notes")).toBe(false);
  });

  it("accepts the same list in another order", async () => {
    registry.index.plugins = [registryEntry("notes", [{ version: "1.0.0" }])];
    registry.download.mockImplementation(() => stageArtifact("notes"));
    await boot();
    const result = await manage.installPlugin("notes", {
      userId: "admin",
      capabilities: ["kv:own", "hosts:read"],
    });
    expect(result.state).toBe("active");
  });

  it("needs the added capabilities listed to accept an update", async () => {
    createFixturePlugin({ id: "docker", root: bundled });
    registry.index.plugins = [
      registryEntry("docker", [
        {
          version: "1.1.0",
          capabilities: ["hosts:read", "kv:own", "notify:send"],
        },
        { version: "1.0.0" },
      ]),
    ];
    await boot();

    await expect(
      manage.updatePlugin("docker", {
        userId: "admin",
        acceptCapabilities: true,
        capabilities: ["ssh:connect"],
      }),
    ).rejects.toMatchObject({ code: "CONSENT_MISMATCH" });
    await expect(
      manage.updatePlugin("docker", {
        userId: "admin",
        acceptCapabilities: true,
      }),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    expect(registry.download).not.toHaveBeenCalled();
  });
});

describe("installing from a file", () => {
  async function artifactBuffer(
    id: string,
    manifestOverrides: Record<string, unknown> = {},
  ) {
    const staged = await stageArtifact(id, manifestOverrides);
    const buffer = fs.readFileSync(staged.file);
    fs.rmSync(staged.file);
    return buffer;
  }

  afterEach(() => {
    manage.resetUploads();
    delete process.env.TERMIX_REQUIRE_SIGNED_PLUGINS;
  });

  it("is refused while developer mode is off", async () => {
    await boot();
    await expect(
      manage.stageUpload(await artifactBuffer("notes")),
    ).rejects.toMatchObject({ code: "DEVELOPER_MODE_OFF" });
  });

  it("is refused when signed plugins are required", async () => {
    await boot();
    await manage.setDeveloperMode(true);
    process.env.TERMIX_REQUIRE_SIGNED_PLUGINS = "true";
    await expect(
      manage.stageUpload(await artifactBuffer("notes")),
    ).rejects.toMatchObject({ code: "SIGNED_ONLY" });
  });

  it("stages, asks for consent, then installs it marked unverified", async () => {
    const loader = await boot();
    await manage.setDeveloperMode(true);

    const preview = await manage.stageUpload(
      await artifactBuffer("notes", { capabilities: ["kv:own"] }),
    );
    expect(preview).toMatchObject({
      id: "notes",
      capabilities: ["kv:own"],
      replaces: null,
    });
    expect(loader.get("notes")).toBeUndefined();

    await expect(
      manage.installUpload(preview.token, {
        userId: "admin",
        capabilities: ["kv:own", "hosts:read"],
      }),
    ).rejects.toMatchObject({ code: "CONSENT_MISMATCH" });

    const result = await manage.installUpload(preview.token, {
      userId: "admin",
      capabilities: ["kv:own"],
    });
    expect(result.state).toBe("active");
    expect(db.rows.get("notes")).toMatchObject({
      tier: manage.UNVERIFIED_TIER,
      registryId: null,
    });
    expect(loader.get("notes")?.signedBy).toBeUndefined();
    expect(fs.existsSync(path.join(data, "plugins", "notes.tmxplug"))).toBe(
      true,
    );

    // A token is used once.
    await expect(
      manage.installUpload(preview.token, {
        userId: "admin",
        capabilities: ["kv:own"],
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_EXPIRED" });
  });

  it("replaces an earlier upload but never a bundled plugin", async () => {
    createFixturePlugin({ id: "docker", root: bundled });
    const loader = await boot();
    await manage.setDeveloperMode(true);

    await expect(
      manage.stageUpload(await artifactBuffer("docker")),
    ).rejects.toMatchObject({ code: "BUNDLED_ID" });

    const first = await manage.stageUpload(await artifactBuffer("notes"));
    await manage.installUpload(first.token, {
      userId: "admin",
      capabilities: first.capabilities,
    });
    const second = await manage.stageUpload(
      await artifactBuffer("notes", { version: "1.1.0" }),
    );
    expect(second.replaces).toBe("1.0.0");
    await manage.installUpload(second.token, {
      userId: "admin",
      capabilities: second.capabilities,
    });
    expect(loader.get("notes")?.manifest.version).toBe("1.1.0");
    expect(db.rows.get("notes")?.tier).toBe(manage.UNVERIFIED_TIER);
  });

  it("refuses a file that is not a plugin archive", async () => {
    await boot();
    await manage.setDeveloperMode(true);
    await expect(
      manage.stageUpload(Buffer.from("not a tarball")),
    ).rejects.toMatchObject({ code: "INVALID_ARTIFACT" });
  });

  it("drops staged files when developer mode is turned off", async () => {
    await boot();
    await manage.setDeveloperMode(true);
    const preview = await manage.stageUpload(await artifactBuffer("notes"));
    await manage.setDeveloperMode(false);
    await manage.setDeveloperMode(true);
    await expect(
      manage.installUpload(preview.token, {
        userId: "admin",
        capabilities: preview.capabilities,
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_EXPIRED" });
  });
});
