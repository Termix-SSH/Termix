import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWorkspacePayload,
  buildWorkspaceTabSnapshots,
  remapSlotIds,
  resolveWorkspaceTabTarget,
} from "../../shell/workspaceUtils";
import type { Host, Tab, WorkspaceTabSnapshot } from "@/types/ui-types";

afterEach(() => vi.unstubAllGlobals());

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

  it("captures serialConfig only for serial tabs", () => {
    const tabs: Tab[] = [
      makeTab({
        id: "t1",
        type: "serial",
        serialConfig: {
          path: "/dev/ttyUSB0",
          baudRate: 9600,
          dataBits: 8,
          stopBits: 1,
          parity: "none",
        },
      }),
      makeTab({ id: "t2", type: "terminal", host: makeHost() }),
    ];

    const { snapshots } = buildWorkspaceTabSnapshots(tabs);
    expect(snapshots[0].serialConfig).toEqual({
      path: "/dev/ttyUSB0",
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
    });
    expect(snapshots[0].hostSyncId).toBeNull();
    expect(snapshots[1].serialConfig).toBeUndefined();
  });
});

describe("remapSlotIds", () => {
  it("maps slot ids to live tab ids, preserving nulls and unresolved slots", () => {
    const map = new Map([
      ["slot-a", "new-tab-1"],
      ["slot-b", "new-tab-2"],
    ]);
    const result = remapSlotIds(
      ["slot-a", null, "slot-b", "slot-missing"],
      map,
    );
    expect(result).toEqual(["new-tab-1", null, "new-tab-2", null]);
  });
});

describe("resolveWorkspaceTabTarget", () => {
  const hosts: Host[] = [makeHost({ id: "1", syncId: "sync-web-01" })];

  it("resolves a serial snapshot with a config as 'serial'", () => {
    const snapshot: WorkspaceTabSnapshot = {
      slotId: "s1",
      type: "serial",
      label: "Serial",
      serialConfig: {
        path: "/dev/ttyUSB0",
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
      },
    };
    expect(resolveWorkspaceTabTarget(snapshot, hosts)).toEqual({
      kind: "serial",
    });
  });

  it("skips a serial snapshot missing its config", () => {
    const snapshot: WorkspaceTabSnapshot = {
      slotId: "s1",
      type: "serial",
      label: "Serial",
    };
    expect(resolveWorkspaceTabTarget(snapshot, hosts)).toEqual({
      kind: "skip",
    });
  });

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

  it("skips a non-singleton, non-serial type with no resolvable host", () => {
    const snapshot: WorkspaceTabSnapshot = {
      slotId: "s1",
      type: "files",
      label: "files",
    };
    expect(resolveWorkspaceTabTarget(snapshot, hosts)).toEqual({
      kind: "skip",
    });
  });
});

describe("buildWorkspacePayload", () => {
  it("builds a full payload including pane assignment remapped to slot ids", () => {
    let counter = 0;
    const genSlotId = () => `slot-${counter++}`;

    const host = makeHost();
    const tabs: Tab[] = [
      makeTab({ id: "t1", type: "terminal", host }),
      makeTab({ id: "t2", type: "files", host }),
    ];

    const payload = buildWorkspacePayload({
      tabs,
      activeTabId: "t1",
      splitMode: "2-way",
      paneTabIds: ["t1", "t2", null, null, null, null],
      rowSizes: [100],
      rowColSizes: [[50, 50]],
      genSlotId,
    });

    expect(payload.version).toBe(1);
    expect(payload.activeSlotId).toBe("slot-0");
    expect(payload.paneTabIds).toEqual([
      "slot-0",
      "slot-1",
      null,
      null,
      null,
      null,
    ]);
    expect(payload.splitMode).toBe("2-way");
    expect(payload.rowSizes).toEqual([100]);
    expect(payload.rowColSizes).toEqual([[50, 50]]);
  });

  it("sets activeSlotId to null when the active tab is not capturable", () => {
    const payload = buildWorkspacePayload({
      tabs: [makeTab({ id: "t1", type: "host-manager" })],
      activeTabId: "t1",
      splitMode: "none",
      paneTabIds: [null, null, null, null, null, null],
      rowSizes: [100],
      rowColSizes: [[100]],
    });
    expect(payload.activeSlotId).toBeNull();
    expect(payload.tabs).toHaveLength(0);
  });

  it("round-trips the sidebar arrangement", () => {
    const payload = buildWorkspacePayload({
      tabs: [],
      activeTabId: "dashboard",
      splitMode: "none",
      paneTabIds: [null, null, null, null, null, null],
      rowSizes: [100],
      rowColSizes: [[100]],
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

  it("omits sidebar when not supplied so older payloads stay unchanged", () => {
    const payload = buildWorkspacePayload({
      tabs: [],
      activeTabId: "dashboard",
      splitMode: "none",
      paneTabIds: [null, null, null, null, null, null],
      rowSizes: [100],
      rowColSizes: [[100]],
    });

    expect(payload.sidebar).toBeUndefined();
    expect(payload.version).toBe(1);
  });
});
