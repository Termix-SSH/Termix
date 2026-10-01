import { beforeEach, describe, expect, it } from "vitest";
import {
  registerEntity,
  resetSyncRegistry,
} from "../../../plugins/sync-registry.js";
import {
  MAX_PUSH_OPS,
  orderOps,
  parsePushOps,
  type PushOp,
} from "../../../sync/server/push.js";

beforeEach(() => {
  resetSyncRegistry();
  registerEntity("core", { type: "creds", table: {}, order: 10 });
  registerEntity("core", {
    type: "hosts",
    table: {},
    order: 50,
    references: [
      { field: "parentId", syncField: "parentSyncId", entityType: "hosts" },
    ],
  });
});

const op = (
  entityType: string,
  syncId: string,
  kind: "upsert" | "delete" = "upsert",
  row: Record<string, unknown> = {},
): PushOp => ({
  entityType,
  syncId,
  baseRevision: 0,
  op: kind,
  ...(kind === "upsert" ? { row } : {}),
});

describe("parsing pushed ops", () => {
  it("accepts well-formed ops", () => {
    const ops = [op("hosts", "a"), op("hosts", "b", "delete")];
    expect(parsePushOps({ ops })).toEqual(ops);
  });

  it("refuses malformed or oversized batches", () => {
    expect(parsePushOps({})).toBeNull();
    expect(parsePushOps({ ops: [{ entityType: "hosts" }] })).toBeNull();
    expect(
      parsePushOps({ ops: [{ ...op("hosts", "a"), row: undefined }] }),
    ).toBeNull();
    expect(
      parsePushOps({
        ops: Array.from({ length: MAX_PUSH_OPS + 1 }, (_, i) =>
          op("hosts", String(i)),
        ),
      }),
    ).toBeNull();
  });
});

describe("ordering pushed ops", () => {
  it("writes targets first and parents before children, and deletes last in reverse", () => {
    const ordered = orderOps([
      op("hosts", "old", "delete"),
      op("hosts", "child", "upsert", { parentSyncId: "parent" }),
      op("creds", "gone", "delete"),
      op("hosts", "parent"),
      op("creds", "key"),
    ]);
    expect(ordered.map((o) => `${o.op}:${o.syncId}`)).toEqual([
      "upsert:key",
      "upsert:parent",
      "upsert:child",
      "delete:old",
      "delete:gone",
    ]);
  });
});
