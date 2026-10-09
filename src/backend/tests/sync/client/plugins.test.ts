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
  createCurrentPluginPermissionGrantRepository: () => ({}),
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

const { mirrorPlugins } = await import("../../../sync/client/plugins.js");
const { remoteJson } = await import("../../../sync/client/http.js");

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
});
