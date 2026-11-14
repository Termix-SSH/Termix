/**
 * Applying pushed sync changes: a stale base revision is a conflict that
 * hands back the server's row, permissions and host locks are checked per op,
 * and one bad op never stops the others.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Rec = {
  revision: number;
  seq: number;
  deleted: boolean;
  hash: string | null;
};

const state = vi.hoisted(() => ({
  records: new Map<string, Rec>(),
  wire: new Map<string, unknown>(),
  stored: new Map<string, Record<string, unknown>>(),
  // What the server ends up holding instead of the pushed row.
  storedAs: new Map<string, Record<string, unknown>>(),
  denied: new Set<string>(),
  locked: false,
  failWrite: new Set<string>(),
  missOnce: new Set<string>(),
  notified: 0,
  changed: 0,
}));

vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      hasPermission: async (_u: string, p: string) => !state.denied.has(p),
    }),
  },
}));
vi.mock("../../../hosts/locks.js", () => ({
  hasHostLocks: () => state.locked,
  hostLock: () => (state.locked ? { by: "hosts-config" } : null),
  manualCreateBlockedBy: () => (state.locked ? "hosts-config" : null),
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findHostIdBySyncIdForUser: async () => 4,
  }),
}));
vi.mock("../../../sync/store.js", () => ({
  createResolvers: (_u: string, onMiss: () => void) => ({ onMiss }),
  deleteStoredRow: async (_e: unknown, _u: string, id: string) => {
    state.stored.delete(id);
  },
  writeWireRow: async (
    _e: unknown,
    _u: string,
    row: Record<string, unknown>,
    resolvers: { onMiss: () => void },
  ) => {
    const id = row.syncId as string;
    if (state.failWrite.has(id)) throw new Error("bad row");
    if (state.missOnce.delete(id)) resolvers.onMiss();
    state.stored.set(id, state.storedAs.get(id) ?? row);
  },
  loadWireRow: async (_e: unknown, _u: string, id: string) =>
    state.stored.has(id)
      ? { hash: `h-${id}`, wire: state.stored.get(id) }
      : null,
}));
vi.mock("../../../sync/records.js", () => ({
  recordKey: (t: string, id: string) => `${t}:${id}`,
  getRecord: async (_u: string, t: string, id: string) =>
    state.records.get(`${t}:${id}`) ?? null,
  putRecord: async (_u: string, t: string, id: string, r: Rec) => {
    state.records.set(`${t}:${id}`, r);
  },
  allocateSeq: async () => 1,
}));
vi.mock("../../../sync/server/feed.js", () => ({
  reconcileUser: async () => ({ changed: false, wire: state.wire }),
  notifyListeners: () => {
    state.notified++;
  },
  markChanged: () => {
    state.changed++;
  },
}));

const { registerEntity, resetSyncRegistry } =
  await import("../../../plugins/sync-registry.js");
const { applyPush } = await import("../../../sync/server/push.js");

const up = (
  entityType: string,
  syncId: string,
  baseRevision = 0,
  row = {},
) => ({
  entityType,
  syncId,
  baseRevision,
  op: "upsert" as const,
  row,
});

beforeEach(() => {
  state.records = new Map();
  state.wire = new Map();
  state.stored = new Map();
  state.storedAs = new Map();
  state.denied = new Set();
  state.locked = false;
  state.failWrite = new Set();
  state.missOnce = new Set();
  state.notified = 0;
  state.changed = 0;
  resetSyncRegistry();
  registerEntity("core", {
    type: "hosts",
    table: {},
    order: 50,
    permissions: {
      create: "hosts.create",
      update: "hosts.update",
      delete: "hosts.delete",
    },
  });
  registerEntity("core", {
    type: "roles",
    table: {},
    order: 10,
    readOnly: true,
  });
  registerEntity("core", {
    type: "snippets",
    table: {},
    order: 20,
    // Async, as a plugin process answers it.
    shouldSync: async (row: Record<string, unknown>) => row.private !== true,
  });
});

describe("applyPush", () => {
  it("writes new rows and tells other clients", async () => {
    const results = await applyPush("u1", [
      up("hosts", "a", 0, { name: "web" }),
    ]);
    expect(results).toEqual([
      { syncId: "a", entityType: "hosts", status: "ok", revision: 1 },
    ]);
    expect(state.records.get("hosts:a")).toMatchObject({
      revision: 1,
      hash: "h-a",
    });
    expect(state.notified).toBe(1);
    expect(state.changed).toBe(1);
  });

  it("hands back the server's row on a stale revision", async () => {
    state.records.set("hosts:a", {
      revision: 3,
      seq: 1,
      deleted: false,
      hash: "x",
    });
    state.wire.set("hosts:a", { name: "server copy" });
    const [result] = await applyPush("u1", [up("hosts", "a", 1)]);
    expect(result).toEqual({
      syncId: "a",
      entityType: "hosts",
      status: "conflict",
      revision: 3,
      deleted: false,
      row: { name: "server copy" },
    });
    state.wire.clear();
    const [missing] = await applyPush("u1", [up("hosts", "a", 1)]);
    expect(missing).toMatchObject({
      status: "rejected",
      reason: "unavailable",
    });
  });

  it("refuses unknown and read only types, missing permissions and locked hosts", async () => {
    state.denied.add("hosts.create");
    const results = await applyPush("u1", [
      up("nope", "x"),
      up("roles", "r"),
      up("hosts", "a"),
    ]);
    expect(results.map((r) => (r as { reason?: string }).reason)).toEqual([
      "unknown_type",
      "read_only",
      "permission",
    ]);
    state.denied.clear();
    state.locked = true;
    const [locked] = await applyPush("u1", [up("hosts", "a")]);
    expect(locked).toMatchObject({ status: "rejected", reason: "locked" });
    expect(state.notified).toBe(0);
  });

  it("keeps going after a bad row and skips rows that must not sync", async () => {
    state.failWrite.add("bad");
    const results = await applyPush("u1", [
      up("snippets", "bad"),
      up("snippets", "private", 0, { private: true }),
      up("snippets", "good"),
    ]);
    expect(results.map((r) => r.status)).toEqual([
      "rejected",
      "rejected",
      "ok",
    ]);
    expect((results[0] as { reason: string }).reason).toBe("invalid: bad row");
    expect((results[1] as { reason: string }).reason).toBe("not_synced");
  });

  it("deletes with a tombstone and answers a repeat of the op as a duplicate", async () => {
    state.records.set("hosts:a", {
      revision: 2,
      seq: 1,
      deleted: false,
      hash: "x",
    });
    state.stored.set("a", {});
    const results = await applyPush("u1", [
      { entityType: "hosts", syncId: "a", baseRevision: 2, op: "delete" },
      { entityType: "hosts", syncId: "a", baseRevision: 2, op: "delete" },
    ]);
    expect(results[0]).toMatchObject({ status: "ok", revision: 3 });
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: "duplicate",
    });
    expect(state.records.get("hosts:a")).toMatchObject({
      revision: 3,
      deleted: true,
    });
    expect(state.stored.has("a")).toBe(false);
  });

  it("writes a row again when something it points at arrived later in the batch", async () => {
    state.missOnce.add("child");
    const results = await applyPush("u1", [
      up("snippets", "child", 0, { v: 1 }),
    ]);
    expect(results[0]).toMatchObject({ status: "ok", revision: 1 });
    expect(state.records.get("snippets:child")).toMatchObject({
      hash: "h-child",
    });
  });
});

describe("applyPush with verified fields", () => {
  const settings = (rdpPort: number) => ({
    pluginSettings: { "remote-desktop": { rdpPort, enableRdp: true } },
  });

  beforeEach(() => {
    state.records.set("hosts:h1", {
      revision: 3,
      seq: 1,
      deleted: false,
      hash: "old",
    });
    resetSyncRegistry();
    registerEntity(
      "core",
      { type: "hosts", table: {}, order: 50 },
      { verifyFields: ["pluginSettings"] },
    );
  });

  it("answers with the server's row when a plugin setting did not take", async () => {
    const held = { name: "web", ...settings(3389), syncId: "h1" };
    state.storedAs.set("h1", held);
    const [result] = await applyPush("u1", [
      up("hosts", "h1", 3, { name: "web", ...settings(3390) }),
    ]);
    expect(result).toEqual({
      syncId: "h1",
      entityType: "hosts",
      status: "conflict",
      revision: 4,
      deleted: false,
      row: held,
    });
  });

  it("is ok when the server holds the push and settings of its own", async () => {
    state.storedAs.set("h1", {
      name: "web",
      syncId: "h1",
      pluginSettings: {
        "remote-desktop": { rdpPort: 3390, enableRdp: 1 },
        "server-only": { mode: "x" },
      },
    });
    const [result] = await applyPush("u1", [
      up("hosts", "h1", 3, { name: "web", ...settings(3390) }),
    ]);
    expect(result).toMatchObject({ status: "ok", revision: 4 });
  });

  it("ignores settings of a plugin or field the server does not know", async () => {
    state.storedAs.set("h1", { name: "web", ...settings(3390), syncId: "h1" });
    const [result] = await applyPush("u1", [
      up("hosts", "h1", 3, {
        name: "web",
        pluginSettings: {
          "remote-desktop": { rdpPort: 3390, enableRdp: true, newField: 1 },
          "desktop-only": { mode: "y" },
        },
      }),
    ]);
    expect(result).toMatchObject({ status: "ok" });
  });
});
