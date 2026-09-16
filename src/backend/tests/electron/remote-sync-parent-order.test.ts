import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { deserializeSyncReferences } from "../../database/routes/sync-references.js";

const filename = resolve("electron/remote-sync.cjs");
const localRequire = createRequire(filename);
const { orderSyncWrites } = localRequire("./sync-write-order.cjs");
const moduleStub = { exports: {} };
const Engine = runInNewContext(
  readFileSync(filename, "utf8") + "\nRemoteSyncEngine;",
  {
    module: moduleStub,
    require: (name: string) => (name === "electron" ? {} : localRequire(name)),
  },
);

type Row = {
  syncId: string;
  updatedAt: string;
  parentHostSyncId: string | null;
};
const local = "http://127.0.0.1:30001";
const remote = "https://remote.example";

describe("nested host sync writes", () => {
  it.each([local, remote])(
    "copies parents before reparented children into %s",
    async (destination) => {
      const oldChild: Row = {
        syncId: "child",
        updatedAt: "2026-01-01",
        parentHostSyncId: null,
      };
      const parent: Row = {
        syncId: "parent",
        updatedAt: "2026-01-02",
        parentHostSyncId: null,
      };
      const newChild: Row = {
        ...oldChild,
        updatedAt: "2026-01-02",
        parentHostSyncId: "parent",
      };
      const source = destination === local ? remote : local;
      const stores = new Map<string, Map<string, Row>>([
        [destination, new Map([["child", oldChild]])],
        [
          source,
          new Map([
            ["parent", parent],
            ["child", newChild],
          ]),
        ],
      ]);
      const engine = new Engine(() => null);
      engine.localJwt = "local-token";
      engine.pullSide = async (url: string) => [...stores.get(url)!.values()];
      engine.pullTombstones = async () => [];
      const written: string[] = [];
      engine.pushRow = async (
        url: string,
        _token: string,
        entity: "hosts",
        row: Row,
      ) => {
        await deserializeSyncReferences(entity, row, async (_type, id) =>
          stores.get(url)!.has(id) ? 1 : null,
        );
        stores.get(url)!.set(row.syncId, row);
        written.push(row.syncId);
      };
      await engine.syncEntity({
        entityType: "hosts",
        remoteBaseUrl: remote,
        remoteJwt: "remote-token",
      });
      expect(written).toEqual(["parent", "child"]);
      expect(stores.get(destination)!.get("child")!.parentHostSyncId).toBe(
        "parent",
      );
      written.length = 0;
      await engine.syncEntity({
        entityType: "hosts",
        remoteBaseUrl: remote,
        remoteJwt: "remote-token",
      });
      expect(written).toEqual([]);
    },
  );

  it("rejects cyclic write dependencies before any writes are sent", () => {
    const writes = [
      { baseUrl: local, row: { syncId: "a", parentHostSyncId: "b" } },
      { baseUrl: local, row: { syncId: "b", parentHostSyncId: "a" } },
    ];
    expect(() => orderSyncWrites("hosts", writes)).toThrow(
      "Cyclic parent host",
    );
  });

  it("does not confuse writes to different destinations", () => {
    const writes = [
      { baseUrl: local, row: { syncId: "a", parentHostSyncId: "b" } },
      { baseUrl: remote, row: { syncId: "b", parentHostSyncId: "a" } },
    ];
    expect(orderSyncWrites("hosts", writes)).toEqual(writes);
    expect(orderSyncWrites("snippets", writes)).toBe(writes);
  });
});
