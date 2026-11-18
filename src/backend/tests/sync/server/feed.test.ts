/**
 * The change feed reconciler: new and changed rows get a new revision, rows
 * that are gone get a tombstone, and an entity that fails to load is never
 * read as every row deleted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Rec = {
  entityType: string;
  syncId: string;
  revision: number;
  hash: string | null;
  deleted: boolean;
};

const state = vi.hoisted(() => ({
  entities: [] as Array<{ type: string; covers?: (id: string) => boolean }>,
  rows: new Map<string, unknown>(),
  records: new Map<string, unknown>(),
  puts: [] as Array<[string, string, Record<string, unknown>]>,
  seq: 0,
}));

vi.mock("../../../plugins/sync-registry.js", () => ({
  listEntities: () => state.entities,
}));
vi.mock("../../../sync/entities.js", () => ({
  registerCoreSyncEntities: () => {},
}));
vi.mock("../../../sync/store.js", () => ({
  createResolvers: () => ({}),
  loadWireRows: async (entity: { type: string }) => {
    const value = state.rows.get(entity.type);
    if (value instanceof Error) throw value;
    return value;
  },
}));
vi.mock("../../../sync/records.js", () => ({
  recordKey: (type: string, id: string) => `${type}:${id}`,
  listRecords: async () => state.records,
  allocateSeq: async () => ++state.seq,
  putRecord: async (
    _user: string,
    type: string,
    id: string,
    record: Record<string, unknown>,
  ) => {
    state.puts.push([type, id, record]);
  },
}));

const {
  reconcileUser,
  withUserLock,
  addListener,
  notifyListeners,
  markChanged,
} = await import("../../../sync/server/feed.js");

function loaded(rows: Array<[string, string]>, failed: string[] = []) {
  return {
    rows: new Map(
      rows.map(([id, hash]) => [id, { syncId: id, hash, wire: { id } }]),
    ),
    failed: new Set(failed),
  };
}

function record(
  type: string,
  id: string,
  hash: string | null,
  revision = 1,
  deleted = false,
): Rec {
  return { entityType: type, syncId: id, revision, hash, deleted };
}

beforeEach(() => {
  state.entities = [{ type: "host" }];
  state.rows = new Map();
  state.records = new Map();
  state.puts = [];
  markChanged();
});

describe("reconcileUser", () => {
  it("bumps new and changed rows and leaves unchanged ones", async () => {
    state.rows.set(
      "host",
      loaded([
        ["a", "h1"],
        ["b", "h2-new"],
        ["c", "h3"],
      ]),
    );
    state.records.set("host:b", record("host", "b", "h2", 4));
    state.records.set("host:c", record("host", "c", "h3", 2));
    const result = await reconcileUser("u1", { force: true });
    expect(result.changed).toBe(true);
    expect([...result.wire.keys()]).toEqual(["host:a", "host:b", "host:c"]);
    expect(state.puts.map(([, id, r]) => [id, r.revision, r.deleted])).toEqual([
      ["a", 1, false],
      ["b", 5, false],
    ]);
  });

  it("writes a tombstone for a row that is gone, but not for one that failed", async () => {
    state.rows.set("host", loaded([], ["kept"]));
    state.records.set("host:gone", record("host", "gone", "x", 3));
    state.records.set("host:kept", record("host", "kept", "y", 1));
    state.records.set("host:dead", record("host", "dead", null, 2, true));
    await reconcileUser("u1", { force: true });
    expect(state.puts).toEqual([
      [
        "host",
        "gone",
        { revision: 4, seq: expect.any(Number), hash: null, deleted: true },
      ],
    ]);
  });

  it("leaves rows outside what an entity covers alone", async () => {
    state.entities = [{ type: "host", covers: (id) => id !== "other" }];
    state.rows.set("host", loaded([]));
    state.records.set("host:other", record("host", "other", "x"));
    const result = await reconcileUser("u1", { force: true });
    expect(result.changed).toBe(false);
  });

  it("skips an entity that can't load instead of deleting its rows", async () => {
    state.entities = [{ type: "host" }, { type: "snippet" }];
    state.rows.set("host", new Error("db down"));
    state.rows.set("snippet", loaded([["s", "h"]]));
    state.records.set("host:a", record("host", "a", "x"));
    await reconcileUser("u1", { force: true });
    expect(state.puts.map(([type]) => type)).toEqual(["snippet"]);
  });

  it("reuses a recent snapshot until something is written", async () => {
    state.rows.set("host", loaded([["a", "h1"]]));
    const first = await reconcileUser("u2");
    state.rows.set("host", loaded([["a", "h2"]]));
    const second = await reconcileUser("u2");
    expect(second.wire).toBe(first.wire);
    markChanged();
    const third = await reconcileUser("u2");
    expect(third.changed).toBe(true);
  });
});

describe("withUserLock", () => {
  it("runs one user's work at a time and keeps going after a failure", async () => {
    const order: string[] = [];
    const slow = withUserLock("u1", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("first");
    });
    const failing = withUserLock("u1", async () => {
      order.push("second");
      throw new Error("x");
    });
    const after = withUserLock("u1", async () => {
      order.push("third");
      return 3;
    });
    await slow;
    await expect(failing).rejects.toThrow("x");
    expect(await after).toBe(3);
    expect(order).toEqual(["first", "second", "third"]);
  });
});

describe("listeners", () => {
  it("sends a change event to the user's open streams until they close", () => {
    const writes: string[] = [];
    const res = { write: (s: string) => writes.push(s) } as never;
    const remove = addListener("u3", res);
    notifyListeners("u3");
    notifyListeners("someone-else");
    remove();
    notifyListeners("u3");
    expect(writes).toEqual(["event: change\ndata: {}\n\n"]);
  });
});
