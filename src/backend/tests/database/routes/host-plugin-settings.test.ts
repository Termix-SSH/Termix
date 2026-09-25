/**
 * The pluginSettings map attached to host responses.
 *
 * The host editor needs these with the host, not one request per plugin per
 * host, so the shape and the query count both matter.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

interface Row {
  pluginId: string;
  scope: string;
  scopeId: string | null;
  key: string;
  value: string | null;
  encrypted: boolean;
}

const rows: Row[] = [];
const loaded: { id: string; manifest: PluginManifest; state: string }[] = [];
const getAllForScopeIds = vi.fn(async (scope: string, scopeIds: string[]) =>
  rows.filter(
    (row) => row.scope === scope && scopeIds.includes(row.scopeId ?? ""),
  ),
);
const setCalls: Array<[string, string, string, string, string]> = [];
const set = vi.fn(
  async (
    pluginId: string,
    scope: string,
    scopeId: string,
    key: string,
    value: string,
  ) => {
    setCalls.push([pluginId, scope, scopeId, key, value]);
  },
);

vi.mock("../../../utils/logger.js", () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  };
  return { sshLogger: logger, pluginLogger: logger, databaseLogger: logger };
});

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentPluginSettingsRepository: () => ({ getAllForScopeIds, set }),
}));

vi.mock("../../../plugins/index.js", () => ({
  getPluginRuntime: () => ({ loader: { list: () => loaded } }),
}));

vi.mock("../../../utils/system-secret-crypto.js", () => ({
  isSystemEncrypted: (value: string) => value.startsWith("sysenc:v1:"),
  encryptSystemSecret: async (plaintext: string) => plaintext,
  decryptSystemSecret: async (stored: string) => stored,
}));

vi.mock("../../../utils/crypto-migration/raw-rows.js", () => ({
  runStatement: vi.fn(async () => {}),
}));

const registryProviders = new Map<string, unknown>();
vi.mock("../../../plugins/registry.js", () => ({
  consume: (key: string) => registryProviders.get(key),
}));

const {
  attachHostPluginSettings,
  loadHostPluginSettings,
  withHostPluginSettings,
  writeHostPluginSettings,
  applyPluginHostImportSettings,
  setHostPluginEnabled,
} = await import("../../../database/routes/host-plugin-settings.js");

function manifest(id: string, host: unknown): PluginManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: "",
    author: { name: "t" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities: [],
    contributes: { settings: { host } },
  } as PluginManifest;
}

const DOCKER = manifest("docker", {
  enableKey: "enableDocker",
  enableLabelKey: "k",
  fields: [{ key: "socketPath", type: "string", labelKey: "k" }],
});

beforeEach(() => {
  rows.length = 0;
  loaded.length = 0;
  setCalls.length = 0;
  registryProviders.clear();
  getAllForScopeIds.mockClear();
  set.mockClear();
});

describe("loadHostPluginSettings", () => {
  it("returns nothing when no plugin declares host settings", async () => {
    loaded.push({
      id: "other",
      manifest: manifest("other", undefined),
      state: "active",
    });

    const result = await loadHostPluginSettings([1, 2]);

    expect(result.size).toBe(0);
    expect(getAllForScopeIds).not.toHaveBeenCalled();
  });

  it("ignores a plugin that is not running", async () => {
    loaded.push({ id: "docker", manifest: DOCKER, state: "disabled" });

    const result = await loadHostPluginSettings([1]);

    expect(result.size).toBe(0);
  });

  it("uses one query for the whole list", async () => {
    loaded.push({ id: "docker", manifest: DOCKER, state: "active" });

    await loadHostPluginSettings([1, 2, 3, 4, 5]);

    expect(getAllForScopeIds).toHaveBeenCalledTimes(1);
    expect(getAllForScopeIds).toHaveBeenCalledWith("host", [
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
  });

  it("merges stored values over declared defaults", async () => {
    loaded.push({ id: "docker", manifest: DOCKER, state: "active" });
    rows.push({
      pluginId: "docker",
      scope: "host",
      scopeId: "1",
      key: "enableDocker",
      value: JSON.stringify(true),
      encrypted: false,
    });

    const result = await loadHostPluginSettings([1, 2]);

    expect(result.get(1)).toEqual({
      docker: { enableDocker: true, socketPath: undefined },
    });
    // Host 2 has nothing stored, so it falls back to the declared default.
    expect(result.get(2)).toEqual({
      docker: { enableDocker: false, socketPath: undefined },
    });
  });

  it("keeps one host's values out of another's", async () => {
    loaded.push({ id: "docker", manifest: DOCKER, state: "active" });
    rows.push({
      pluginId: "docker",
      scope: "host",
      scopeId: "1",
      key: "socketPath",
      value: JSON.stringify("/var/run/docker.sock"),
      encrypted: false,
    });

    const result = await loadHostPluginSettings([1, 2]);

    expect(result.get(1)!.docker.socketPath).toBe("/var/run/docker.sock");
    expect(result.get(2)!.docker.socketPath).toBeUndefined();
  });

  it("redacts a host-scope secret", async () => {
    loaded.push({
      id: "vault",
      manifest: manifest("vault", {
        fields: [{ key: "token", type: "secret", labelKey: "k" }],
      }),
      state: "active",
    });
    rows.push({
      pluginId: "vault",
      scope: "host",
      scopeId: "1",
      key: "token",
      value: JSON.stringify("s.verysecret"),
      encrypted: true,
    });

    const result = await loadHostPluginSettings([1]);

    expect(result.get(1)!.vault.token).toEqual({ set: true });
    expect(JSON.stringify(result.get(1))).not.toContain("verysecret");
  });

  it("survives a failed settings read rather than failing the host list", async () => {
    loaded.push({ id: "docker", manifest: DOCKER, state: "active" });
    getAllForScopeIds.mockRejectedValueOnce(new Error("database is away"));

    await expect(loadHostPluginSettings([1])).resolves.toEqual(new Map());
  });

  it("does nothing for an empty host list", async () => {
    loaded.push({ id: "docker", manifest: DOCKER, state: "active" });

    expect((await loadHostPluginSettings([])).size).toBe(0);
    expect(getAllForScopeIds).not.toHaveBeenCalled();
  });
});

describe("attachHostPluginSettings", () => {
  it("attaches values to the matching host", () => {
    const hosts = [{ id: 1 }, { id: 2 }] as Record<string, unknown>[];
    const settings = new Map([[1, { docker: { enableDocker: true } }]]);

    attachHostPluginSettings(hosts, settings);

    expect(hosts[0].pluginSettings).toEqual({ docker: { enableDocker: true } });
    expect(hosts[1].pluginSettings).toBeUndefined();
  });

  it("leaves hosts alone when there is nothing to attach", () => {
    const hosts = [{ id: 1 }] as Record<string, unknown>[];

    attachHostPluginSettings(hosts, new Map());

    expect(hosts[0]).toEqual({ id: 1 });
  });
});

describe("withHostPluginSettings", () => {
  it("adds the map to a single host", async () => {
    loaded.push({ id: "docker", manifest: DOCKER, state: "active" });

    const result = await withHostPluginSettings({ id: 1, name: "web" });

    expect(result.name).toBe("web");
    expect(result.pluginSettings).toEqual({
      docker: { enableDocker: false, socketPath: undefined },
    });
  });

  it("returns the host unchanged when nothing contributes", async () => {
    const host = { id: 1, name: "web" };

    expect(await withHostPluginSettings(host)).toBe(host);
  });

  it("returns the host unchanged when its id is not a number", async () => {
    loaded.push({ id: "docker", manifest: DOCKER, state: "active" });
    const host = { name: "web" };

    expect(await withHostPluginSettings(host)).toBe(host);
  });
});

describe("writeHostPluginSettings", () => {
  it("JSON-stringifies each value under the plugin's own namespace", async () => {
    await writeHostPluginSettings("docker", 7, {
      enableDocker: true,
      socketPath: null,
    });

    expect(setCalls).toEqual([
      ["docker", "host", "7", "enableDocker", "true"],
      ["docker", "host", "7", "socketPath", "null"],
    ]);
  });

  it("skips a field whose value is undefined", async () => {
    await writeHostPluginSettings("docker", 7, {
      enableDocker: true,
      socketPath: undefined,
    });

    expect(setCalls).toEqual([["docker", "host", "7", "enableDocker", "true"]]);
  });
});

describe("applyPluginHostImportSettings", () => {
  it("runs every enabled plugin's registered normalizer and writes what it returns", async () => {
    loaded.push({ id: "docker", manifest: DOCKER, state: "active" });
    loaded.push({
      id: "web-endpoint",
      manifest: manifest("web-endpoint", {
        enableKey: "enableWebUi",
        enableLabelKey: "k",
        fields: [{ key: "webUiConfig", type: "json", labelKey: "k" }],
      }),
      state: "active",
    });
    registryProviders.set("docker.hostImportNormalizer", () => ({
      enableDocker: true,
    }));
    registryProviders.set("web-endpoint.hostImportNormalizer", () => null);

    await applyPluginHostImportSettings(7, { enableDocker: true });

    expect(setCalls).toEqual([["docker", "host", "7", "enableDocker", "true"]]);
  });

  it("skips a plugin with no registered normalizer", async () => {
    loaded.push({ id: "docker", manifest: DOCKER, state: "active" });

    await applyPluginHostImportSettings(7, {});

    expect(setCalls).toEqual([]);
  });

  it("logs and continues past a normalizer that throws", async () => {
    loaded.push({ id: "docker", manifest: DOCKER, state: "active" });
    loaded.push({
      id: "web-endpoint",
      manifest: manifest("web-endpoint", {
        enableKey: "enableWebUi",
        enableLabelKey: "k",
        fields: [{ key: "webUiConfig", type: "json", labelKey: "k" }],
      }),
      state: "active",
    });
    registryProviders.set("docker.hostImportNormalizer", () => {
      throw new Error("boom");
    });
    registryProviders.set("web-endpoint.hostImportNormalizer", () => ({
      enableWebUi: true,
    }));

    await expect(applyPluginHostImportSettings(7, {})).resolves.toBeUndefined();
    expect(setCalls).toEqual([
      ["web-endpoint", "host", "7", "enableWebUi", "true"],
    ]);
  });
});

describe("share levels, legacy fields and generic writes", () => {
  const DESKTOP = manifest("remote-desktop", {
    fields: [
      { key: "enableRdp", type: "boolean", labelKey: "k" },
      {
        key: "guacamoleConfig",
        type: "json",
        labelKey: "k",
        shareRead: "edit",
      },
      { key: "gatewayToken", type: "secret", labelKey: "k" },
    ],
  });

  it("hides a field above a recipient's share level", () => {
    loaded.push({ id: "remote-desktop", manifest: DESKTOP, state: "active" });
    const values = new Map([
      [
        1,
        {
          "remote-desktop": { enableRdp: true, guacamoleConfig: { a: 1 } },
        },
      ],
    ]);
    const connect = { id: 1, isShared: true, permissionLevel: "connect" };
    const edit = { id: 1, isShared: true, permissionLevel: "edit" };
    const owner = { id: 1 };
    attachHostPluginSettings([connect, edit, owner], values);

    expect(connect).toMatchObject({
      pluginSettings: { "remote-desktop": { enableRdp: true } },
    });
    expect(
      (connect as { pluginSettings: Record<string, Record<string, unknown>> })
        .pluginSettings["remote-desktop"],
    ).not.toHaveProperty("guacamoleConfig");
    expect(edit).toMatchObject({
      pluginSettings: { "remote-desktop": { guacamoleConfig: { a: 1 } } },
    });
    expect(owner).toMatchObject({
      pluginSettings: { "remote-desktop": { guacamoleConfig: { a: 1 } } },
    });
  });

  it("adds a plugin's legacy payload fields without overwriting core's", () => {
    loaded.push({ id: "docker", manifest: DOCKER, state: "active" });
    registryProviders.set(
      "docker.hostPayloadLegacy",
      (own: Record<string, unknown>) => ({
        enableDocker: own.enableDocker,
        name: "overwritten?",
      }),
    );
    const host: Record<string, unknown> = { id: 2, name: "web" };
    attachHostPluginSettings(
      [host],
      new Map([[2, { docker: { enableDocker: true } }]]),
    );
    expect(host.enableDocker).toBe(true);
    expect(host.name).toBe("web");
  });

  it("imports an export's plugin values, leaving secrets out", async () => {
    loaded.push({ id: "remote-desktop", manifest: DESKTOP, state: "active" });
    await applyPluginHostImportSettings(9, {
      pluginSettings: {
        "remote-desktop": { enableRdp: true, gatewayToken: { set: true } },
      },
    });
    expect(setCalls).toEqual([
      ["remote-desktop", "host", "9", "enableRdp", "true"],
    ]);
  });

  it("flips a plugin's host switch for many hosts", async () => {
    loaded.push({ id: "docker", manifest: DOCKER, state: "active" });
    expect(await setHostPluginEnabled("docker", [3, 4], true)).toBe(true);
    expect(setCalls.map((call) => [call[2], call[3], call[4]])).toEqual([
      ["3", "enableDocker", "true"],
      ["4", "enableDocker", "true"],
    ]);
    expect(await setHostPluginEnabled("missing", [3], true)).toBe(false);
  });
});
