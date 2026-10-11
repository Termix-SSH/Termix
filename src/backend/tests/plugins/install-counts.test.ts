import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  stats: null as null | {
    plugins: Map<string, { downloads: number; activeInstalls: number | null }>;
  },
  fail: false,
  sources: [{ id: "official", tier: "official" }] as Array<{
    id: string;
    tier: string;
  }>,
  statsBySource: {} as Record<
    string,
    {
      plugins: Map<
        string,
        { downloads: number; activeInstalls: number | null }
      >;
    } | null
  >,
  upserted: [] as Array<{ registryId: string; entries: unknown[] }>,
  rows: [] as Array<{ pluginId: string; count: number; source: string }>,
}));

vi.mock("../../plugins/registry-index.js", () => ({
  OFFICIAL_REGISTRY_ID: "official",
  officialSource: () => ({ id: "official", tier: "official" }),
  fetchRegistryStats: async (source: { id: string }) => {
    if (state.fail) throw new Error("offline");
    return state.statsBySource[source.id] ?? state.stats;
  },
}));

vi.mock("../../plugins/registries.js", () => ({
  listSources: async () => state.sources,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginInstallCountRepository: () => ({
    upsertMany: async (registryId: string, entries: unknown[]) => {
      state.upserted.push({ registryId, entries });
      return entries.length;
    },
    listByRegistry: async () => state.rows,
  }),
}));

const {
  DOWNLOADS_SOURCE,
  TELEMETRY_SOURCE,
  preferredCount,
  readInstallCounts,
  syncInstallCounts,
} = await import("../../plugins/install-counts.js");

beforeEach(() => {
  state.stats = null;
  state.fail = false;
  state.sources = [{ id: "official", tier: "official" }];
  state.statsBySource = {};
  state.upserted = [];
  state.rows = [];
});

describe("syncInstallCounts with more registries", () => {
  it("stores counts per registry and skips custom ones", async () => {
    state.sources = [
      { id: "official", tier: "official" },
      { id: "community", tier: "community" },
      { id: "mine", tier: "custom" },
    ];
    state.statsBySource = {
      official: {
        plugins: new Map([["docker", { downloads: 5, activeInstalls: null }]]),
      },
      community: {
        plugins: new Map([["neat", { downloads: 3, activeInstalls: 2 }]]),
      },
      mine: null,
    };
    expect(await syncInstallCounts()).toBe(2);
    expect(state.upserted.map((entry) => entry.registryId)).toEqual([
      "official",
      "community",
    ]);
  });
});

describe("preferredCount", () => {
  it("prefers active installs and falls back to downloads", () => {
    expect(preferredCount({ downloads: 90, activeInstalls: 12 })).toEqual({
      count: 12,
      source: TELEMETRY_SOURCE,
    });
    expect(preferredCount({ downloads: 90, activeInstalls: null })).toEqual({
      count: 90,
      source: DOWNLOADS_SOURCE,
    });
    expect(preferredCount({ downloads: 90, activeInstalls: 0 })).toEqual({
      count: 90,
      source: DOWNLOADS_SOURCE,
    });
  });
});

describe("syncInstallCounts", () => {
  it("writes one row per plugin with its preferred source", async () => {
    state.stats = {
      plugins: new Map([
        ["docker", { downloads: 50, activeInstalls: 20 }],
        ["tunnels", { downloads: 8, activeInstalls: null }],
      ]),
    };
    expect(await syncInstallCounts()).toBe(2);
    expect(state.upserted).toEqual([
      {
        registryId: "official",
        entries: [
          { pluginId: "docker", count: 20, source: TELEMETRY_SOURCE },
          { pluginId: "tunnels", count: 8, source: DOWNLOADS_SOURCE },
        ],
      },
    ]);
  });

  it("keeps the old numbers when the registry is unreachable", async () => {
    state.fail = true;
    expect(await syncInstallCounts()).toBe(0);
    expect(state.upserted).toEqual([]);
  });

  it("does nothing for a registry with no stats file", async () => {
    expect(await syncInstallCounts()).toBe(0);
    expect(state.upserted).toEqual([]);
  });
});

describe("readInstallCounts", () => {
  it("maps the stored rows by plugin id", async () => {
    state.rows = [{ pluginId: "docker", count: 20, source: TELEMETRY_SOURCE }];
    const counts = await readInstallCounts();
    expect(counts.get("docker")).toEqual({
      count: 20,
      source: TELEMETRY_SOURCE,
    });
  });
});
