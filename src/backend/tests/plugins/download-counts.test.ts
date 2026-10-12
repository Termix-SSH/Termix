import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  stats: null as null | { plugins: Map<string, number> },
  fail: false,
  sources: [{ id: "official", tier: "official" }] as Array<{
    id: string;
    tier: string;
  }>,
  statsBySource: {} as Record<string, { plugins: Map<string, number> } | null>,
  upserted: [] as Array<{ registryId: string; entries: unknown[] }>,
  rows: [] as Array<{ pluginId: string; count: number }>,
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
  readDownloadCounts,
  refreshDownloadCounts,
  resetDownloadCountRefresh,
  syncDownloadCounts,
} = await import("../../plugins/download-counts.js");

beforeEach(() => {
  state.stats = null;
  state.fail = false;
  state.sources = [{ id: "official", tier: "official" }];
  state.statsBySource = {};
  state.upserted = [];
  state.rows = [];
  resetDownloadCountRefresh();
});

describe("refreshDownloadCounts", () => {
  const docker = () => ({ plugins: new Map([["docker", 5]]) });

  it("syncs on the first look and not again while fresh", async () => {
    state.stats = docker();
    await refreshDownloadCounts();
    await refreshDownloadCounts();
    expect(state.upserted).toHaveLength(1);
  });

  it("does not sync again right away even when forced", async () => {
    state.stats = docker();
    await refreshDownloadCounts();
    await refreshDownloadCounts(true);
    expect(state.upserted).toHaveLength(1);
  });

  it("syncs again when forced after a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      state.stats = docker();
      await refreshDownloadCounts();
      vi.setSystemTime(Date.now() + 61_000);
      await refreshDownloadCounts();
      expect(state.upserted).toHaveLength(1);
      await refreshDownloadCounts(true);
      expect(state.upserted).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("syncDownloadCounts", () => {
  it("writes one row per plugin", async () => {
    state.stats = {
      plugins: new Map([
        ["docker", 50],
        ["tunnels", 8],
      ]),
    };
    expect(await syncDownloadCounts()).toBe(2);
    expect(state.upserted).toEqual([
      {
        registryId: "official",
        entries: [
          { pluginId: "docker", count: 50 },
          { pluginId: "tunnels", count: 8 },
        ],
      },
    ]);
  });

  it("stores counts per registry and skips custom ones", async () => {
    state.sources = [
      { id: "official", tier: "official" },
      { id: "community", tier: "community" },
      { id: "mine", tier: "custom" },
    ];
    state.statsBySource = {
      official: { plugins: new Map([["docker", 5]]) },
      community: { plugins: new Map([["neat", 3]]) },
      mine: null,
    };
    expect(await syncDownloadCounts()).toBe(2);
    expect(state.upserted.map((entry) => entry.registryId)).toEqual([
      "official",
      "community",
    ]);
  });

  it("keeps the old numbers when the registry is unreachable", async () => {
    state.fail = true;
    expect(await syncDownloadCounts()).toBe(0);
    expect(state.upserted).toEqual([]);
  });

  it("does nothing for a registry with no stats file", async () => {
    expect(await syncDownloadCounts()).toBe(0);
    expect(state.upserted).toEqual([]);
  });
});

describe("readDownloadCounts", () => {
  it("maps the stored rows by plugin id", async () => {
    state.rows = [{ pluginId: "docker", count: 20 }];
    const counts = await readDownloadCounts();
    expect(counts.get("docker")).toBe(20);
  });
});
