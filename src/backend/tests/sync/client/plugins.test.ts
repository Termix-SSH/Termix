import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  dir: "",
  loaded: new Map<string, Record<string, unknown>>(),
  enabled: new Set<string>(),
  install: vi.fn(),
  fetch: vi.fn(),
  loadBundled: vi.fn(),
  syncedKeys: vi.fn(async (_keys: unknown[]) => {}),
  syncedOnlyKeys: new Set<string>(),
  grants: [] as string[],
}));

vi.mock("../../../utils/logger.js", () => ({
  syncLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../notify/core-notify.js", () => ({
  sendCoreAlert: vi.fn(async () => {}),
}));
vi.mock("../../../plugins/paths.js", () => ({
  getPluginsDir: () => state.dir,
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) => ({
      state: state.enabled.has(id) ? "enabled" : "disabled",
    }),
  }),
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async () => [],
    grant: async ({ capability }: { capability: string }) =>
      void state.grants.push(capability),
  }),
}));
vi.mock("../../../plugins/registries.js", () => ({
  setSyncedRegistryKeys: state.syncedKeys,
  isLocallyTrustedPluginKey: (keyId: string) =>
    keyId === "local-key" && !state.syncedOnlyKeys.has(keyId),
}));
vi.mock("../../../sync/client/http.js", () => ({
  remoteFetch: state.fetch,
  remoteJson: vi.fn(),
}));
vi.mock("../../../plugins/index.js", () => ({
  getPluginRuntime: () => ({
    loader: {
      get: (id: string) => state.loaded.get(id),
      list: () => [...state.loaded.values()],
      loadBundled: state.loadBundled,
    },
  }),
  installPluginArtifact: state.install,
  registerLoadedPlugins: vi.fn(async () => {}),
  setPluginEnabled: vi.fn(async (id: string, on: boolean) => {
    if (on) state.enabled.add(id);
    else state.enabled.delete(id);
  }),
  unloadPlugin: vi.fn(async (id: string) => {
    state.loaded.delete(id);
  }),
}));

const { mirrorPlugins, isServerManaged } =
  await import("../../../sync/client/plugins.js");
const { remoteJson } = await import("../../../sync/client/http.js");
const { sendCoreAlert } = await import("../../../notify/core-notify.js");

const bundled = {
  id: "ssh-terminal",
  source: "bundled",
  state: "active",
  manifest: { id: "ssh-terminal", version: "1.0.0", capabilities: [] },
};

function serverHas(version: string) {
  vi.mocked(remoteJson).mockResolvedValue({
    plugins: [
      {
        id: "ssh-terminal",
        name: "SSH Terminal",
        version,
        source: "bundled",
        artifact: true,
        enabled: true,
        active: true,
        desktop: "mirror",
        syncEntities: [],
        granted: [],
      },
    ],
  });
}

beforeEach(() => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-mirror-"));
  state.loaded = new Map([["ssh-terminal", { ...bundled }]]);
  state.enabled = new Set(["ssh-terminal"]);
  state.install.mockReset();
  state.fetch.mockReset();
  state.loadBundled.mockReset();
  state.syncedOnlyKeys = new Set();
  state.grants = [];
  vi.mocked(sendCoreAlert).mockClear();
  state.loadBundled.mockImplementation(async (id: string) => {
    const plugin = { ...bundled, id };
    state.loaded.set(id, plugin);
    return plugin;
  });
});

afterEach(() => {
  fs.rmSync(state.dir, { recursive: true, force: true });
});

describe("mirrorPlugins", () => {
  it("trusts the server's custom registry keys before downloading", async () => {
    vi.mocked(remoteJson).mockResolvedValue({
      plugins: [],
      registryKeys: ["a-key"],
    });
    await mirrorPlugins({} as never);
    expect(state.syncedKeys).toHaveBeenCalledWith(["a-key"]);

    vi.mocked(remoteJson).mockResolvedValue({ plugins: [] });
    await mirrorPlugins({} as never);
    expect(state.syncedKeys).toHaveBeenLastCalledWith([]);
  });

  it("keeps the installed copy when the download fails", async () => {
    serverHas("1.1.0");
    state.fetch.mockResolvedValue({ ok: false, status: 502 });

    await mirrorPlugins({} as never);

    expect(state.loaded.has("ssh-terminal")).toBe(true);
    expect(state.enabled.has("ssh-terminal")).toBe(true);
    expect(state.install).not.toHaveBeenCalled();
  });

  it("puts the shipped copy back when the new one fails to install", async () => {
    serverHas("1.1.0");
    state.fetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
      headers: new Headers(),
    });
    state.install.mockRejectedValue(new Error("signature check failed"));

    await mirrorPlugins({} as never);

    expect(state.loadBundled).toHaveBeenCalledWith("ssh-terminal");
    expect(state.loaded.has("ssh-terminal")).toBe(true);
    expect(state.enabled.has("ssh-terminal")).toBe(true);
    expect(fs.existsSync(path.join(state.dir, "ssh-terminal.tmxplug"))).toBe(
      false,
    );
  });

  it("restores an earlier update file when a newer one fails", async () => {
    serverHas("1.2.0");
    const file = path.join(state.dir, "ssh-terminal.tmxplug");
    fs.writeFileSync(file, "old");
    state.fetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
      headers: new Headers(),
    });
    state.install
      .mockRejectedValueOnce(new Error("bad archive"))
      .mockImplementationOnce(async () => {
        const plugin = { ...bundled };
        state.loaded.set("ssh-terminal", plugin);
        return plugin;
      });

    await mirrorPlugins({} as never);

    expect(fs.readFileSync(file, "utf8")).toBe("old");
    expect(state.install).toHaveBeenCalledTimes(2);
    expect(state.loaded.has("ssh-terminal")).toBe(true);
    expect(state.enabled.has("ssh-terminal")).toBe(true);
  });

  describe("a user plugin the server has on", () => {
    function serverRunsSignedBy(
      keyId: string,
      enabled = true,
      version = keyId === "removed-key" ? "1.0.1" : "1.0.0",
    ) {
      state.loaded.set("extra", {
        id: "extra",
        source: "user",
        state: "loaded",
        signedBy: keyId,
        manifest: { id: "extra", version, capabilities: ["net"] },
      });
      vi.mocked(remoteJson).mockResolvedValue({
        plugins: [
          {
            id: "extra",
            name: "Extra",
            version,
            source: "user",
            artifact: true,
            enabled,
            active: enabled,
            desktop: "mirror",
            syncEntities: [],
            granted: ["net"],
          },
        ],
      });
    }

    it("turns it on when a key this desktop trusts signed it", async () => {
      serverRunsSignedBy("local-key");

      await mirrorPlugins({} as never);

      expect(state.enabled.has("extra")).toBe(true);
      expect(state.grants).toEqual(["net"]);
    });

    it.each(["server-key", "removed-key"])(
      "leaves it off for untrusted key %s",
      async (keyId) => {
        serverRunsSignedBy(keyId);
        state.syncedOnlyKeys.add("server-key");

        await mirrorPlugins({} as never);

        expect(state.enabled.has("extra")).toBe(false);
        expect(state.grants).toEqual([]);
        expect(sendCoreAlert).toHaveBeenCalledWith(
          expect.objectContaining({ category: "termix.sync.unsigned_plugin" }),
        );
      },
    );

    it("leaves the server in charge of one a trusted key signed", () => {
      serverRunsSignedBy("local-key");
      expect(isServerManaged("extra")).toBe(true);
    });

    it.each(["server-key", "removed-key"])(
      "lets this desktop's admin decide on one signed by %s",
      async (keyId) => {
        serverRunsSignedBy(keyId);
        state.syncedOnlyKeys.add("server-key");
        expect(isServerManaged("extra")).toBe(false);

        state.enabled.add("extra");
        await mirrorPlugins({} as never);
        expect(state.enabled.has("extra")).toBe(true);
      },
    );

    it("still switches an untrusted one off when the server does", async () => {
      serverRunsSignedBy("server-key", false);
      state.syncedOnlyKeys.add("server-key");
      state.enabled.add("extra");

      await mirrorPlugins({} as never);

      expect(state.enabled.has("extra")).toBe(false);
    });

    it.each([
      ["server-key", false],
      ["local-key", true],
    ])(
      "after an update signed by %s, keeps it on: %s",
      async (keyId, stays) => {
        serverRunsSignedBy(keyId, true, "2.0.0");
        state.syncedOnlyKeys.add("server-key");
        const reviewed = state.loaded.get("extra")!;
        state.loaded.set("extra", {
          ...reviewed,
          manifest: { id: "extra", version: "1.0.0", capabilities: ["net"] },
        });
        state.enabled.add("extra");
        state.fetch.mockResolvedValue({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(4),
          headers: new Headers(),
        });
        state.install.mockImplementation(async () => {
          const plugin = { ...reviewed };
          state.loaded.set("extra", plugin);
          return plugin;
        });

        await mirrorPlugins({} as never);

        expect(state.install).toHaveBeenCalled();
        expect(state.enabled.has("extra")).toBe(stays);
        expect(vi.mocked(sendCoreAlert).mock.calls.length > 0).toBe(!stays);
      },
    );
  });
});

it("server bundled label must not enable a synced-only user plugin", async () => {
  state.syncedOnlyKeys.add("server-key");
  state.loaded.set("extra", {
    id: "extra",
    source: "user",
    state: "loaded",
    signedBy: "server-key",
    manifest: { id: "extra", version: "1.0.0", capabilities: [] },
  });
  vi.mocked(remoteJson).mockResolvedValue({
    plugins: [
      {
        id: "extra",
        name: "Extra",
        version: "1.0.0",
        source: "bundled",
        artifact: true,
        enabled: true,
        active: true,
        desktop: "mirror",
        syncEntities: [],
        granted: [],
      },
    ],
  });
  await mirrorPlugins({} as never);
  expect(state.enabled.has("extra")).toBe(false);
});

it("remote bundled label cannot preserve approval across an untrusted update", async () => {
  const reviewed = {
    id: "extra",
    source: "user",
    state: "loaded",
    signedBy: "server-key",
    manifest: { id: "extra", version: "1.0.0", capabilities: [] },
  };
  state.loaded.set("extra", reviewed);
  state.syncedOnlyKeys.add("server-key");
  state.enabled.add("extra");
  vi.mocked(remoteJson).mockResolvedValue({
    plugins: [
      {
        id: "extra",
        name: "Extra",
        version: "2.0.0",
        source: "bundled",
        artifact: true,
        enabled: true,
        active: true,
        desktop: "mirror",
        syncEntities: [],
        granted: [],
      },
    ],
  });
  state.fetch.mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(4),
    headers: new Headers(),
  });
  state.install.mockImplementation(async () => {
    const plugin = {
      ...reviewed,
      manifest: { ...reviewed.manifest, version: "2.0.0" },
    };
    state.loaded.set("extra", plugin);
    return plugin;
  });
  await mirrorPlugins({} as never);
  expect(state.install).toHaveBeenCalledOnce();
  expect(state.enabled.has("extra")).toBe(false);
});

it("waits for an in-flight local plugin change before applying a remote update", async () => {
  const { serialized } = await import("../../../plugins/manage.js");
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const localChange = serialized(async () => {
    entered();
    await barrier;
  });
  await ready;
  serverHas("1.1.0");
  state.fetch.mockResolvedValue({ ok: false, status: 502 });
  vi.mocked(remoteJson).mockClear();
  const syncing = mirrorPlugins({} as never);
  try {
    await vi.waitFor(() => expect(remoteJson).toHaveBeenCalled());
    expect(state.fetch).not.toHaveBeenCalled();
  } finally {
    release();
  }
  await localChange;
  await syncing;
  expect(state.fetch).toHaveBeenCalledOnce();
});
