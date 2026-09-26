import { beforeEach, describe, expect, it } from "vitest";
import {
  registerEntity,
  resetSyncRegistry,
  type RegisteredSyncEntity,
} from "../../plugins/sync-registry.js";
import { getEntity } from "../../plugins/sync-registry.js";
import {
  decryptFields,
  deserializeReferences,
  encryptFields,
  hashWire,
  orderSelfReferences,
  parseReferencePath,
  serializeReferences,
  toWire,
  toWritable,
} from "../../sync/wire.js";
import { FieldCrypto } from "../../utils/field-crypto.js";

const KEY = Buffer.alloc(32, 9);
const OTHER_KEY = Buffer.alloc(32, 4);

function entity(type: string): RegisteredSyncEntity {
  return getEntity(type)!;
}

beforeEach(() => {
  resetSyncRegistry();
  registerEntity("core", {
    type: "things",
    table: {},
    encryptedFields: ["secret"],
    readOnlyFields: ["deviceOnly"],
    references: [
      { field: "parentId", syncField: "parentSyncId", entityType: "things" },
      { field: "hops[].thingId", entityType: "things" },
      {
        field: "bindings[].action.snippetId",
        entityType: "things",
        idType: "string",
      },
    ],
  });
});

const toSync = async (_type: string, id: number) =>
  id === 404 ? null : `sync-${id}`;
const toId = async (_type: string, syncId: string) =>
  syncId === "sync-missing" ? null : Number(syncId.replace("sync-", ""));

describe("reference paths", () => {
  it("parses columns, arrays and nested objects", () => {
    expect(parseReferencePath("credentialId")).toBeNull();
    expect(parseReferencePath("jumpHosts[].hostId")).toEqual({
      column: "jumpHosts",
      steps: [
        { key: "", each: true },
        { key: "hostId", each: false },
      ],
    });
    expect(parseReferencePath("layout.panes[].hostId")).toEqual({
      column: "layout",
      steps: [
        { key: "panes", each: true },
        { key: "hostId", each: false },
      ],
    });
  });
});

describe("serializing references", () => {
  it("turns column and JSON ids into sync ids, keeping the storage form", async () => {
    const wire = await serializeReferences(
      entity("things"),
      {
        id: 1,
        parentId: 7,
        hops: JSON.stringify([{ thingId: 3 }, { thingId: 404 }]),
        bindings: [{ action: { type: "run", snippetId: "12" } }],
      },
      toSync,
    );

    expect(wire.parentId).toBeUndefined();
    expect(wire.parentSyncId).toBe("sync-7");
    expect(JSON.parse(wire.hops as string)).toEqual([
      { thingId: "sync-3" },
      { thingId: null },
    ]);
    expect(wire.bindings).toEqual([
      { action: { type: "run", snippetId: "sync-12" } },
    ]);
  });

  it("round-trips back to local ids, including string ids", async () => {
    const back = await deserializeReferences(
      entity("things"),
      {
        parentSyncId: "sync-7",
        hops: JSON.stringify([{ thingId: "sync-3" }]),
        bindings: [{ action: { snippetId: "sync-12" } }],
      },
      toId,
      null,
    );

    expect(back.parentId).toBe(7);
    expect(back.parentSyncId).toBeUndefined();
    expect(JSON.parse(back.hops as string)).toEqual([{ thingId: 3 }]);
    expect(back.bindings).toEqual([{ action: { snippetId: "12" } }]);
  });

  it("keeps the current value when a referenced row is not here", async () => {
    const back = await deserializeReferences(
      entity("things"),
      { parentSyncId: "sync-missing" },
      toId,
      { parentId: 5 },
    );
    expect(back.parentId).toBe(5);

    const fresh = await deserializeReferences(
      entity("things"),
      { parentSyncId: "sync-missing" },
      toId,
      null,
    );
    expect(fresh.parentId).toBeNull();
  });

  it("runs a registration's own serialize after the references", async () => {
    resetSyncRegistry();
    registerEntity("demo", {
      type: "custom",
      table: {},
      references: [
        { field: "otherId", syncField: "otherSyncId", entityType: "custom" },
      ],
      serialize: async (row) => ({ ...row, extra: row.otherSyncId }),
    });
    const wire = await serializeReferences(
      entity("custom"),
      { otherId: 2 },
      toSync,
    );
    expect(wire.extra).toBe("sync-2");
  });
});

describe("secret fields", () => {
  it("decrypts to plaintext and encrypts again", () => {
    const stored = encryptFields(
      entity("things"),
      { id: 1, secret: "hunter2" },
      KEY,
      "1",
    );
    expect(FieldCrypto.isEncrypted(stored.secret as string)).toBe(true);

    const plain = decryptFields(entity("things"), stored, KEY);
    expect(plain.secret).toBe("hunter2");
  });

  it("refuses to decrypt with the wrong key instead of sending an empty secret", () => {
    const stored = encryptFields(
      entity("things"),
      { id: 1, secret: "hunter2" },
      KEY,
      "1",
    );
    expect(() => decryptFields(entity("things"), stored, OTHER_KEY)).toThrow();
  });

  it("leaves plaintext and already encrypted values alone when encrypting", () => {
    const once = encryptFields(entity("things"), { secret: "a" }, KEY, "1");
    const twice = encryptFields(entity("things"), once, KEY, "1");
    expect(twice.secret).toBe(once.secret);
    expect(
      decryptFields(entity("things"), { id: 1, secret: "plain" }, KEY).secret,
    ).toBe("plain");
  });
});

describe("wire shape", () => {
  it("drops local ids, the owner and device-only fields", () => {
    const wire = toWire(
      entity("things"),
      { id: 3, userId: "u", name: "a", deviceOnly: true },
      "s-1",
    );
    expect(wire).toEqual({ name: "a", syncId: "s-1" });
  });

  it("never lets an inbound row set ids, the owner or device-only fields", () => {
    const writable = toWritable(entity("things"), {
      id: 99,
      syncId: "s",
      userId: "attacker",
      deviceOnly: true,
      createdAt: "x",
      updatedAt: "y",
      name: "a",
    });
    expect(writable).toEqual({ name: "a" });
  });
});

describe("content hash", () => {
  const hash = (row: Record<string, unknown>) =>
    hashWire(entity("things"), row, KEY);

  it("ignores where a row lives and device-only fields", () => {
    expect(hash({ syncId: "a", name: "x", updatedAt: "1" })).toBe(
      hash({ syncId: "b", name: "x", updatedAt: "2", deviceOnly: true }),
    );
  });

  it("treats the same content the same whatever the driver returned", () => {
    expect(hash({ on: true, empty: null, json: '{"b":1,"a":2}' })).toBe(
      hash({ on: 1, empty: "", json: { a: 2, b: 1 } }),
    );
  });

  it("changes when a secret changes and depends on the key", () => {
    expect(hash({ secret: "a" })).not.toBe(hash({ secret: "b" }));
    expect(hashWire(entity("things"), { secret: "a" }, OTHER_KEY)).not.toBe(
      hash({ secret: "a" }),
    );
  });
});

describe("self references", () => {
  it("puts parents before their children", () => {
    const rows = orderSelfReferences(entity("things"), [
      { syncId: "child", parentSyncId: "parent" },
      { syncId: "grandchild", parentSyncId: "child" },
      { syncId: "parent", parentSyncId: null },
    ]);
    expect(rows.map((row) => row.syncId)).toEqual([
      "parent",
      "child",
      "grandchild",
    ]);
  });

  it("does not loop on a cycle", () => {
    const rows = orderSelfReferences(entity("things"), [
      { syncId: "a", parentSyncId: "b" },
      { syncId: "b", parentSyncId: "a" },
    ]);
    expect(rows).toHaveLength(2);
  });
});
