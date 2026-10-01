import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLayoutPayload as buildWorkspacePayload,
  buildLayoutTabSnapshots as buildWorkspaceTabSnapshots,
  resolveLayoutSplits,
  resolveLayoutTabTarget as resolveWorkspaceTabTarget,
  snapshotData,
} from "@/shell/shell-layout";
import { registerTabType, resetTabTypes } from "@/shell/tab-registry";
import { makeSplitTab } from "@/shell/split/split-tabs";
import {
  createPane,
  createSplitNode,
  createSplitState,
  listPanes,
} from "@/shell/split/split-tree";
import type {
  Host,
  Tab,
  WorkspacePayload,
  WorkspaceTabSnapshot,
} from "@/types/ui-types";

// Plugin tab types take part in layouts only while registered, so the ones
// these cases use are registered the way their plugins would.
beforeEach(() => {
  registerTabType({ id: "terminal", component: () => null, persistent: true });
  registerTabType({
    id: "fleet-inventory",
    component: () => null,
    singleton: true,
    hostless: true,
  });
  registerTabType({
    id: "web-endpoint",
    component: () => null,
    inLayouts: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetTabTypes();
});

function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    id: "1",
    name: "web-01",
    username: "root",
    ip: "10.0.0.1",
    port: 22,
    folder: "",
    online: true,
    cpu: null,
    ram: null,
    lastAccess: "2026-01-01T00:00:00.000Z",
    authType: "password",
    enableTerminal: true,
    enableCommandHistory: true,
    syncId: "sync-web-01",
    ...overrides,
  } as Host;
}

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "tab-1",
    instanceId: "instance-1",
    type: "terminal",
    label: "web-01",
    openedAt: 0,
    ...overrides,
  } as Tab;
}

describe("buildWorkspaceTabSnapshots", () => {
  it("falls back when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {});
    const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" })];

    const { snapshots } = buildWorkspaceTabSnapshots(tabs);

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].slotId).toBeTruthy();
    expect(snapshots[1].slotId).not.toBe(snapshots[0].slotId);
  });

  it("captures host-bound and singleton tabs with generated slot ids", () => {
    let counter = 0;
    const genSlotId = () => `slot-${counter++}`;

    const host = makeHost();
    const tabs: Tab[] = [
      makeTab({ id: "t1", type: "terminal", host, label: "web-01" }),
      makeTab({ id: "t2", type: "tunnel", label: "Tunnels" }),
    ];

    const { snapshots, slotIdByTabId } = buildWorkspaceTabSnapshots(
      tabs,
      genSlotId,
    );

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({
      slotId: "slot-0",
      type: "terminal",
      hostSyncId: "sync-web-01",
      hostNameSnapshot: "web-01",
    });
    expect(snapshots[1]).toMatchObject({
      slotId: "slot-1",
      type: "tunnel",
      hostSyncId: null,
    });
    expect(slotIdByTabId.get("t1")).toBe("slot-0");
    expect(slotIdByTabId.get("t2")).toBe("slot-1");
  });

  it("excludes rail-view pseudo tabs (host-manager, user-profile, admin-settings)", () => {
    const tabs: Tab[] = [
      makeTab({ id: "t1", type: "host-manager" }),
      makeTab({ id: "t2", type: "user-profile" }),
      makeTab({ id: "t3", type: "admin-settings" }),
      makeTab({ id: "t4", type: "tunnel" }),
    ];

    const { snapshots } = buildWorkspaceTabSnapshots(tabs);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].type).toBe("tunnel");
  });

  it("excludes the dashboard tab - it's a permanent fallback, not a meaningful part of a saved arrangement", () => {
    const tabs: Tab[] = [
      makeTab({ id: "t1", type: "dashboard" }),
      makeTab({ id: "t2", type: "terminal", host: makeHost() }),
    ];

    const { snapshots } = buildWorkspaceTabSnapshots(tabs);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].type).toBe("terminal");
  });
});

describe("resolveWorkspaceTabTarget", () => {
  const hosts: Host[] = [makeHost({ id: "1", syncId: "sync-web-01" })];

  it("resolves a host-bound snapshot by matching syncId", () => {
    const snapshot: WorkspaceTabSnapshot = {
      slotId: "s1",
      type: "terminal",
      label: "web-01",
      hostSyncId: "sync-web-01",
    };
    const result = resolveWorkspaceTabTarget(snapshot, hosts);
    expect(result.kind).toBe("host");
    expect((result as { host: Host }).host.syncId).toBe("sync-web-01");
  });

  it("skips a host-bound snapshot whose host no longer exists", () => {
    const snapshot: WorkspaceTabSnapshot = {
      slotId: "s1",
      type: "terminal",
      label: "deleted-host",
      hostSyncId: "sync-gone",
      hostNameSnapshot: "deleted-host",
    };
    expect(resolveWorkspaceTabTarget(snapshot, hosts)).toEqual({
      kind: "skip",
    });
  });

  it("resolves a hostless singleton type without a hostSyncId", () => {
    const snapshot: WorkspaceTabSnapshot = {
      slotId: "s1",
      type: "tunnel",
      label: "Tunnels",
    };
    expect(resolveWorkspaceTabTarget(snapshot, hosts)).toEqual({
      kind: "singleton",
      host: undefined,
    });
  });

  it("resolves a singleton type WITH a resolved host as singleton+host (e.g. fleet-inventory)", () => {
    const snapshot: WorkspaceTabSnapshot = {
      slotId: "s1",
      type: "fleet-inventory",
      label: "Fleet",
      hostSyncId: "sync-web-01",
    };
    const result = resolveWorkspaceTabTarget(snapshot, hosts);
    expect(result.kind).toBe("singleton");
    expect((result as { host?: Host }).host?.syncId).toBe("sync-web-01");
  });

  it("reopens a hostless, non-singleton type with a host as its own tab", () => {
    registerTabType({ id: "tunnel", component: () => null, hostless: true });
    const snapshot: WorkspaceTabSnapshot = {
      slotId: "s1",
      type: "tunnel",
      label: "Tunnels",
      hostSyncId: "sync-web-01",
    };
    const result = resolveWorkspaceTabTarget(snapshot, hosts);
    expect(result.kind).toBe("host");
    expect((result as { host?: Host }).host?.syncId).toBe("sync-web-01");
  });

  it("skips a non-singleton, non-plugin type with no resolvable host", () => {
    const snapshot: WorkspaceTabSnapshot = {
      slotId: "s1",
      type: "host-manager",
      label: "host-manager",
    };
    expect(resolveWorkspaceTabTarget(snapshot, hosts)).toEqual({
      kind: "skip",
    });
  });

  it("keeps a saved tab whose owning plugin is not running as a placeholder", () => {
    // "files" is the file-manager plugin's tab type. Nothing registered it in
    // this test, matching the plugin being disabled, failed or still loading.
    const snapshot: WorkspaceTabSnapshot = {
      slotId: "s1",
      type: "files",
      label: "files",
    };
    expect(resolveWorkspaceTabTarget(snapshot, hosts)).toEqual({
      kind: "singleton",
    });
  });
});

function splitOf(id: string, tabIds: (string | null)[]): Tab {
  const root = createSplitNode(
    "row",
    tabIds.map((tabId) => createPane(tabId)),
  );
  const split = makeSplitTab(id, `Split ${id}`, createSplitState(root), 0);
  return split;
}

describe("buildWorkspacePayload", () => {
  it("saves every split with its pane tabs swapped for slot ids", () => {
    let counter = 0;
    const genSlotId = () => `slot-${counter++}`;
    const host = makeHost();
    const tabs: Tab[] = [
      makeTab({ id: "t1", type: "terminal", host, parentSplitTabId: "a" }),
      makeTab({ id: "t2", type: "files", host, parentSplitTabId: "a" }),
      makeTab({ id: "t3", type: "terminal", host, parentSplitTabId: "b" }),
      splitOf("a", ["t1", "t2", null]),
      splitOf("b", ["t3"]),
    ];

    const payload = buildWorkspacePayload({
      tabs,
      activeTabId: "split-b",
      genSlotId,
    });

    expect(payload.version).toBe(2);
    expect(payload.tabs.map((tab) => tab.slotId)).toEqual([
      "slot-0",
      "slot-1",
      "slot-2",
    ]);
    expect(payload.splits).toHaveLength(2);
    const [first, second] = payload.splits!;
    expect(first.label).toBe("Split a");
    expect(listPanes(first.root).map((pane) => pane.tabId)).toEqual([
      "slot-0",
      "slot-1",
      null,
    ]);
    expect(listPanes(second.root).map((pane) => pane.tabId)).toEqual([
      "slot-2",
    ]);
    expect(payload.activeSlotId).toBe(second.slotId);
    expect(payload.splitMode).toBeUndefined();
  });

  it("leaves out a split none of whose tabs are saved", () => {
    const payload = buildWorkspacePayload({
      tabs: [
        makeTab({ id: "w", type: "web-endpoint", parentSplitTabId: "a" }),
        splitOf("a", ["w", null]),
      ],
      activeTabId: "split-a",
    });
    expect(payload.splits).toEqual([]);
    expect(payload.activeSlotId).toBeNull();
  });

  it("sets activeSlotId to null when the active tab is not capturable", () => {
    const payload = buildWorkspacePayload({
      tabs: [makeTab({ id: "t1", type: "host-manager" })],
      activeTabId: "t1",
    });
    expect(payload.activeSlotId).toBeNull();
    expect(payload.tabs).toHaveLength(0);
  });

  it("round-trips the sidebar arrangement", () => {
    const payload = buildWorkspacePayload({
      tabs: [],
      activeTabId: "dashboard",
      sidebar: {
        left: { view: "hosts", open: true, width: 320 },
        right: { view: "history", open: true, width: 240 },
      },
    });

    expect(payload.sidebar).toEqual({
      left: { view: "hosts", open: true, width: 320 },
      right: { view: "history", open: true, width: 240 },
    });
  });

  it("omits sidebar when not supplied", () => {
    const payload = buildWorkspacePayload({
      tabs: [],
      activeTabId: "dashboard",
    });
    expect(payload.sidebar).toBeUndefined();
  });
});

describe("resolveLayoutSplits", () => {
  it("rebuilds each saved split with live tab ids", () => {
    const tabs: Tab[] = [
      makeTab({ id: "t1", type: "terminal", parentSplitTabId: "a" }),
      makeTab({ id: "t2", type: "terminal", parentSplitTabId: "a" }),
      splitOf("a", ["t1", "t2"]),
    ];
    const payload = buildWorkspacePayload({
      tabs,
      activeTabId: "split-a",
      genSlotId: (() => {
        let n = 0;
        return () => `slot-${n++}`;
      })(),
    });

    const live = new Map([
      ["slot-0", "new-1"],
      ["slot-1", "new-2"],
    ]);
    const [restored] = resolveLayoutSplits(payload, live);
    expect(restored.label).toBe("Split a");
    expect(restored.slotId).toBe(payload.splits![0].slotId);
    expect(listPanes(restored.split.root).map((pane) => pane.tabId)).toEqual([
      "new-1",
      "new-2",
    ]);
  });

  it("drops a saved split none of whose tabs came back", () => {
    const payload = buildWorkspacePayload({
      tabs: [
        makeTab({ id: "t1", type: "terminal", parentSplitTabId: "a" }),
        splitOf("a", ["t1"]),
      ],
      activeTabId: "split-a",
    });
    expect(resolveLayoutSplits(payload, new Map())).toEqual([]);
  });

  it("reads the single fixed-mode split of a version 1 payload", () => {
    const payload: WorkspacePayload = {
      version: 1,
      tabs: [],
      activeSlotId: "slot-a",
      splitMode: "3-way",
      paneTabIds: ["slot-a", "slot-b", "slot-c", null, null, null],
      rowSizes: [30, 70],
      rowColSizes: [[40, 60], [100]],
    };
    const live = new Map([
      ["slot-a", "a"],
      ["slot-b", "b"],
      ["slot-c", "c"],
    ]);
    const [restored] = resolveLayoutSplits(payload, live);
    expect(restored.label).toBeNull();
    expect(restored.slotId).toBeNull();
    const root = restored.split.root;
    expect(root.kind).toBe("split");
    if (root.kind !== "split") return;
    expect(root.direction).toBe("row");
    expect(root.sizes[0]).toBeCloseTo(40);
    expect(listPanes(root).map((pane) => pane.tabId)).toEqual(["a", "b", "c"]);
  });

  it("finds no splits in a version 1 payload without one", () => {
    expect(
      resolveLayoutSplits(
        {
          version: 1,
          tabs: [],
          activeSlotId: null,
          splitMode: "none",
          paneTabIds: [],
          rowSizes: [100],
          rowColSizes: [[100]],
        },
        new Map(),
      ),
    ).toEqual([]);
  });
});

describe("plugin tab types in layouts", () => {
  it("leaves out a tab type that opts out of layouts", () => {
    const { snapshots } = buildWorkspaceTabSnapshots([
      makeTab({ id: "w", type: "web-endpoint" }),
      makeTab({ id: "t", type: "terminal" }),
    ]);
    expect(snapshots.map((s) => s.type)).toEqual(["terminal"]);
  });

  it("keeps a plugin tab type nobody registered, so a disabled plugin loses nothing", () => {
    const { snapshots } = buildWorkspaceTabSnapshots([
      makeTab({ id: "x", type: "some-plugin-tab", data: { a: 1 } }),
      makeTab({ id: "d", type: "dashboard" }),
      makeTab({ id: "h", type: "host-manager" }),
    ]);
    expect(snapshots.map((s) => s.type)).toEqual(["some-plugin-tab"]);
    expect(snapshotData(snapshots[0])).toEqual({ a: 1 });
  });

  it("reopens a hostless tab of a missing plugin as a placeholder", () => {
    expect(
      resolveWorkspaceTabTarget(
        { slotId: "s", type: "some-plugin-tab", label: "Gone" },
        [],
      ),
    ).toEqual({ kind: "singleton" });
  });

  it("reopens a missing plugin's host tab while its host exists", () => {
    const host = makeHost({ syncId: "sync-1" });
    expect(
      resolveWorkspaceTabTarget(
        {
          slotId: "s",
          type: "some-plugin-tab",
          label: "Gone",
          hostSyncId: "sync-1",
        },
        [host],
      ),
    ).toEqual({ kind: "host", host });
    expect(
      resolveWorkspaceTabTarget(
        {
          slotId: "s",
          type: "some-plugin-tab",
          label: "Gone",
          hostSyncId: "sync-deleted",
        },
        [host],
      ),
    ).toEqual({ kind: "skip" });
  });

  it("carries a tab's plugin data and reads the older fleetId field", () => {
    const { snapshots } = buildWorkspaceTabSnapshots([
      makeTab({ id: "f", type: "fleet-inventory", data: { fleetId: 3 } }),
    ]);
    expect(snapshotData(snapshots[0])).toEqual({ fleetId: 3 });
    expect(
      snapshotData({
        slotId: "s",
        type: "fleet-inventory",
        label: "",
        fleetId: 7,
      }),
    ).toEqual({ fleetId: 7 });
  });
});
