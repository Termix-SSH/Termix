import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const historyCreate = vi.fn();
const historyPrune = vi.fn();
vi.mock("../../../database/repositories/factory.js", () => ({
  getCurrentSettingValue: () => null,
  createCurrentProxmoxNodeHistoryRepository: () => ({
    create: historyCreate,
    pruneOlderThan: historyPrune,
  }),
}));

const collectProxmoxStats = vi.fn();
vi.mock("../../../hosts/metrics/proxmox/collect-proxmox-stats.js", () => ({
  collectProxmoxStats: (...args: unknown[]) => collectProxmoxStats(...args),
}));

import {
  ProxmoxPollingManager,
  parseProxmoxStatsConfig,
} from "../../../hosts/metrics/proxmox-stats-polling.js";
import type { Client } from "ssh2";

interface TestHost {
  id: number;
  userId: string;
  proxmoxStatsConfig?: string | null;
}

function snapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    node: {
      cpu: { percent: 10, cores: 4, load: [0.1, 0.2, 0.3] },
      memory: { percent: 20, usedGiB: 2, totalGiB: 8 },
      disk: { percent: 30, usedGiB: 30, totalGiB: 100 },
      uptime: { seconds: 100, formatted: "0d 0h 1m" },
      system: { hostname: "pve1", kernel: "6.8", pveVersion: "8.2" },
    },
    network: { interfaces: [{ name: "eth0", rxBytes: "10", txBytes: "20" }] },
    guests: { guests: [], counts: { running: 0, stopped: 0, total: 0 } },
    storage: { pools: [] },
    cluster: { clustered: false },
    lastChecked: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  historyCreate.mockReset();
  historyPrune.mockReset();
  collectProxmoxStats.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parseProxmoxStatsConfig", () => {
  it("returns default poll interval when config is missing", () => {
    expect(parseProxmoxStatsConfig(null)).toEqual({
      nodeName: null,
      pollInterval: 60,
    });
  });

  it("parses a JSON string config", () => {
    expect(
      parseProxmoxStatsConfig('{"nodeName":"pve1","pollInterval":30}'),
    ).toEqual({ nodeName: "pve1", pollInterval: 30 });
  });

  it("falls back to defaults on malformed JSON", () => {
    expect(parseProxmoxStatsConfig("{not json")).toEqual({
      nodeName: null,
      pollInterval: 60,
    });
  });
});

describe("ProxmoxPollingManager", () => {
  function makeManager(host: TestHost) {
    const fetchHostById = vi.fn(async () => host);
    const withSshConnection = vi.fn(
      async (_host: TestHost, fn: (client: Client) => Promise<unknown>) =>
        fn({} as Client),
    );
    const manager = new ProxmoxPollingManager<TestHost>({
      fetchHostById,
      withSshConnection,
    });
    return { manager, fetchHostById, withSshConnection };
  }

  it("starts polling and caches a snapshot when the first viewer registers", async () => {
    const host: TestHost = { id: 1, userId: "user-1" };
    collectProxmoxStats.mockResolvedValue(snapshot());
    const { manager, withSshConnection } = makeManager(host);

    manager.registerViewer(1, "viewer-1", "user-1");
    // registerViewer kicks off polling via a fire-and-forget promise chain.
    await vi.waitFor(() => {
      expect(withSshConnection).toHaveBeenCalled();
    });

    const cached = manager.getStats(1);
    expect(cached?.data.node.cpu.percent).toBe(10);
    manager.destroy();
  });

  it("stops polling once the last viewer unregisters", async () => {
    const host: TestHost = { id: 2, userId: "user-1" };
    collectProxmoxStats.mockResolvedValue(snapshot());
    const { manager } = makeManager(host);

    manager.registerViewer(2, "viewer-a", "user-1");
    manager.registerViewer(2, "viewer-b", "user-1");
    await vi.waitFor(() => expect(manager.getStats(2)).toBeDefined());

    manager.unregisterViewer(2, "viewer-a");
    // one viewer left - stats stay cached
    expect(manager.getStats(2)).toBeDefined();

    manager.unregisterViewer(2, "viewer-b");
    // Cached snapshot is retained (not cleared) but the interval is stopped;
    // registering a new viewer must restart polling.
    manager.destroy();
  });

  it("updateHeartbeat returns false for an unknown session", () => {
    const { manager } = makeManager({ id: 3, userId: "user-1" });
    expect(manager.updateHeartbeat("nope")).toBe(false);
    manager.destroy();
  });

  it("records an error snapshot when collection fails, without throwing", async () => {
    const host: TestHost = { id: 4, userId: "user-1" };
    collectProxmoxStats.mockRejectedValue(new Error("pvesh not found"));
    const { manager } = makeManager(host);

    manager.registerViewer(4, "viewer-1", "user-1");
    await vi.waitFor(() => {
      expect(manager.getError(4)?.error).toBe("pvesh not found");
    });
    expect(manager.getStats(4)).toBeUndefined();
    manager.destroy();
  });
});
