import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  accessCalls: 0,
  hostCalls: 0,
  targetCalls: 0,
  denied: new Set<number>(),
}));

vi.mock("../../operations/registry.js", () => ({
  getAction: (id: string) => ({
    pluginId: "demo",
    action: { id, hostAccess: "view", when: { protocol: "ssh" } },
  }),
}));
vi.mock("../../plugins/index.js", () => ({
  getPluginRuntime: () => ({
    loader: { get: () => ({ manifest: { id: "demo" } }) },
  }),
}));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: async (_user: string, hostId: number) => {
        state.accessCalls++;
        await new Promise((resolve) => setTimeout(resolve, 5 - hostId));
        return { hasAccess: !state.denied.has(hostId) };
      },
    }),
  },
}));
vi.mock("../../plugins/ctx-probe.js", () => ({
  loadProbeTargets: async () => {
    state.targetCalls++;
    return [{ id: 1 }, { id: 2 }, { id: 3 }];
  },
}));
vi.mock("../../operations/hosts.js", () => ({
  loadOperationHost: async (id: number) => {
    state.hostCalls++;
    return { id, protocol: id === 3 ? "rdp" : "ssh" };
  },
}));
vi.mock("@termix-ssh/plugin-sdk/operations", () => ({
  matchesWhen: (when: { protocol: string }, host: { protocol: string }) =>
    when.protocol === host.protocol,
}));
vi.mock("../../plugins/host-status-provider.js", () => ({
  hostStatus: { get: () => null },
}));
vi.mock("../../operations/gate.js", () => ({
  runOperation: async () => ({ status: "success", data: { status: "ok" } }),
  OperationError: class extends Error {},
}));

import {
  clearResourceCache,
  createReadScope,
  mapLimited,
  readAcrossHosts,
} from "../../operations/resources.js";

const origin = { kind: "ui" } as never;

beforeEach(() => {
  clearResourceCache();
  state.accessCalls = 0;
  state.hostCalls = 0;
  state.targetCalls = 0;
  state.denied.clear();
});

describe("readAcrossHosts", () => {
  it("keeps host order and skips hosts the action does not apply to", async () => {
    state.denied.add(2);
    const reads = await readAcrossHosts({
      userId: "u",
      actionId: "demo.a",
      origin,
    });
    expect(reads).toEqual([
      { hostId: 1, state: "loading" },
      { hostId: 2, state: "no-access" },
    ]);
  });

  it("asks about each host once across reads sharing a scope", async () => {
    const scope = createReadScope();
    for (const actionId of ["demo.a", "demo.b", "demo.c"]) {
      await readAcrossHosts({ userId: "u", actionId, origin, scope });
    }
    expect(state.targetCalls).toBe(1);
    expect(state.accessCalls).toBe(3);
    expect(state.hostCalls).toBe(3);
  });
});

describe("mapLimited", () => {
  it("keeps order and never runs more than the limit", async () => {
    let running = 0;
    let most = 0;
    const out = await mapLimited([5, 1, 4, 2, 3], 2, async (n) => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, n));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(most).toBe(2);
  });
});
