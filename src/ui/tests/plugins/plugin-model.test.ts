import { describe, expect, it } from "vitest";
import type { PluginSummary, RegistryPluginEntry } from "@/api/plugins-api";
import {
  categoriesOf,
  describeContributions,
  formatBytes,
  matchesQuery,
  mergePlugins,
  orderByRisk,
  pluginStatus,
  sortPlugins,
} from "@/plugins/plugin-model";

function summary(overrides: Partial<PluginSummary> = {}): PluginSummary {
  return {
    id: "docker",
    name: "Docker",
    version: "1.0.0",
    enabled: true,
    state: "active",
    contributes: null,
    capabilities: ["kv:own"],
    ...overrides,
  };
}

function entry(
  overrides: Partial<RegistryPluginEntry> = {},
): RegistryPluginEntry {
  return {
    id: "docker",
    name: "Docker",
    description: "Containers",
    author: "Termix",
    category: "Infrastructure",
    versions: [
      {
        version: "1.1.0",
        compatible: true,
        capabilities: ["kv:own", "ssh:connect"],
        publishedAt: "2026-10-02",
        size: 1,
      },
    ],
    latestVersion: "1.1.0",
    installed: true,
    installedVersion: "1.0.0",
    updateAvailable: true,
    addedCapabilities: ["ssh:connect"],
    pinnedVersion: null,
    autoUpdate: false,
    bundled: true,
    ...overrides,
  };
}

describe("mergePlugins", () => {
  it("joins an installed plugin with its registry entry", () => {
    const [row] = mergePlugins([summary()], [entry()]);
    expect(row).toMatchObject({
      installed: true,
      version: "1.0.0",
      latestVersion: "1.1.0",
      updateAvailable: true,
      addedCapabilities: ["ssh:connect"],
      capabilities: ["kv:own"],
      category: "Infrastructure",
      inRegistry: true,
      status: "running",
    });
  });

  it("lists registry plugins that are not installed with the latest capabilities", () => {
    const rows = mergePlugins(
      [],
      [entry({ installed: false, installedVersion: null })],
    );
    expect(rows[0]).toMatchObject({
      installed: false,
      version: null,
      status: null,
      capabilities: ["kv:own", "ssh:connect"],
    });
  });

  it("keeps installed plugins when the registry is unreachable", () => {
    const rows = mergePlugins([summary()], null);
    expect(rows).toHaveLength(1);
    expect(rows[0].inRegistry).toBe(false);
  });
});

describe("pluginStatus", () => {
  it("maps loader and stored states", () => {
    expect(pluginStatus(summary({ state: "failed" }))).toBe("failed");
    expect(pluginStatus(summary({ state: "blocked" }))).toBe("blocked");
    expect(pluginStatus(summary({ enabled: false, state: "disabled" }))).toBe(
      "disabled",
    );
    expect(pluginStatus(summary())).toBe("running");
  });
});

describe("sorting and filtering", () => {
  const rows = mergePlugins(
    [],
    [
      entry({ id: "b", name: "Beta", category: "Monitoring" }),
      entry({
        id: "a",
        name: "Alpha",
        category: "Access",
        description: "Sign in",
        versions: [
          {
            version: "1.0.0",
            compatible: true,
            capabilities: [],
            publishedAt: "2026-10-05",
            size: 1,
          },
        ],
      }),
    ],
  );

  it("sorts by name, date and category", () => {
    expect(sortPlugins(rows, "name").map((r) => r.id)).toEqual(["a", "b"]);
    expect(sortPlugins(rows, "updated").map((r) => r.id)).toEqual(["a", "b"]);
    expect(sortPlugins(rows, "category").map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("searches name, description and id", () => {
    expect(
      rows.filter((r) => matchesQuery(r, "sign")).map((r) => r.id),
    ).toEqual(["a"]);
    expect(rows.filter((r) => matchesQuery(r, "  ")).length).toBe(2);
  });

  it("collects categories", () => {
    expect(categoriesOf(rows)).toEqual(["Access", "Monitoring"]);
  });
});

describe("helpers", () => {
  it("orders capabilities worst first", () => {
    expect(orderByRisk(["kv:own", "hosts:write", "credentials:read"])).toEqual([
      "credentials:read",
      "hosts:write",
      "kv:own",
    ]);
  });

  it("counts contributions", () => {
    expect(
      describeContributions({
        tabs: [{}, {}],
        settings: { admin: [] },
        auth: { loginMethods: [{}], secondFactors: [] },
        panels: [],
      }),
    ).toEqual([
      { kind: "tabs", count: 2 },
      { kind: "auth", count: 1 },
      { kind: "settings", count: 1 },
    ]);
  });

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
  });
});
