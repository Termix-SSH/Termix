import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CORE_OWNER,
  getEntity,
  hasEntity,
  listEntities,
  listEntityTypes,
  registerEntity,
  resetSyncRegistry,
  unregisterByOwner,
} from "../../plugins/sync-registry.js";
import { registerCoreSyncEntities } from "../../sync/entities.js";

beforeEach(() => {
  resetSyncRegistry();
});

afterEach(() => {
  resetSyncRegistry();
});

describe("sync registry", () => {
  it("orders entities by their declared order, then by name", () => {
    registerEntity("core", { type: "b", table: {}, order: 20 });
    registerEntity("core", { type: "a", table: {}, order: 10 });
    registerEntity("core", { type: "c", table: {}, order: 10 });

    expect(listEntityTypes()).toEqual(["a", "c", "b"]);
  });

  it("defaults the user column and the optional lists", () => {
    registerEntity("core", { type: "thing", table: {} });

    expect(getEntity("thing")).toMatchObject({
      userColumn: "userId",
      readOnlyFields: [],
      encryptedFields: [],
    });
  });

  it("refuses an entity another owner already registered", () => {
    registerEntity("core", { type: "hosts", table: {} });

    expect(() =>
      registerEntity("evil-plugin", { type: "hosts", table: {} }),
    ).toThrow(/already registered by "core"/);
  });

  it("lets the same owner re-register, which is what reactivation does", () => {
    registerEntity("demo", { type: "thing", table: {}, order: 1 });
    registerEntity("demo", { type: "thing", table: {}, order: 2 });

    expect(getEntity("thing")?.order).toBe(2);
  });

  it("removes an entity when its registration is disposed", () => {
    const dispose = registerEntity("demo", { type: "thing", table: {} });

    expect(hasEntity("thing")).toBe(true);
    dispose();
    expect(hasEntity("thing")).toBe(false);
  });

  it("does not let a stale disposer remove a newer registration", () => {
    // A plugin that crashed and restarted must not revoke the registration
    // its own restart installed.
    const stale = registerEntity("demo", { type: "thing", table: {} });
    resetSyncRegistry();
    registerEntity("other", { type: "thing", table: {} });

    stale();

    expect(getEntity("thing")?.owner).toBe("other");
  });

  it("removes everything an owner registered", () => {
    registerEntity("demo", { type: "a", table: {} });
    registerEntity("demo", { type: "b", table: {} });
    registerEntity("core", { type: "c", table: {} });

    unregisterByOwner("demo");

    expect(listEntityTypes()).toEqual(["c"]);
  });

  it("needs a type", () => {
    expect(() => registerEntity("demo", { type: "", table: {} })).toThrow(
      /needs a type/,
    );
  });
});

describe("entity aliases", () => {
  it("finds an entity by a name core uses for it", () => {
    registerEntity("demo", {
      type: "snippets",
      table: {},
      answersTo: ["commandSnippet"],
    });

    expect(getEntity("commandSnippet")?.type).toBe("snippets");
    expect(getEntity("snippets")?.type).toBe("snippets");
    expect(getEntity("nothing")).toBeUndefined();
  });

  it("keeps core-only options away from plugins", () => {
    registerEntity(
      "demo",
      { type: "thing", table: {} },
      { readOnly: true, load: async () => [] },
    );

    expect(getEntity("thing")?.readOnly).toBeUndefined();
    expect(getEntity("thing")?.load).toBeUndefined();
  });
});

describe("core sync entities", () => {
  beforeEach(() => {
    registerCoreSyncEntities();
  });

  it("registers what core syncs, under the wire names 2.8 used", () => {
    expect(listEntityTypes()).toEqual([
      "accountProfile",
      "sshCredentials",
      "sharedCredentials",
      "sshFolders",
      "hosts",
      "sharedHosts",
      "userPreferences",
      "pluginUserSettings",
    ]);
  });

  it("owns all of them as core", () => {
    for (const entity of listEntities()) {
      expect(entity.owner).toBe(CORE_OWNER);
    }
  });

  it("sorts every column reference target before the entity that points at it", () => {
    const order = new Map(
      listEntities().map((entity) => [entity.type, entity.order]),
    );

    for (const entity of listEntities()) {
      for (const reference of entity.references ?? []) {
        // Rows pointing at themselves are ordered within the entity, and a
        // JSON reference that arrives first is written again once the
        // target exists.
        if (reference.entityType === entity.type) continue;
        if (reference.field.includes(".")) continue;
        expect(
          order.get(reference.entityType),
          `${entity.type} -> ${reference.entityType}`,
        ).toBeLessThan(entity.order);
      }
    }
  });

  it("marks the singletons and nothing else", () => {
    const singletons = listEntities()
      .filter((entity) => entity.singleton)
      .map((entity) => entity.type);

    expect(singletons.sort()).toEqual(["accountProfile", "userPreferences"]);
  });

  it("only sends shared copies and the account one way", () => {
    const readOnly = listEntities()
      .filter((entity) => entity.readOnly)
      .map((entity) => entity.type);

    expect(readOnly.sort()).toEqual([
      "accountProfile",
      "sharedCredentials",
      "sharedHosts",
    ]);
  });

  it("keeps device-only host fields off the wire", () => {
    expect(getEntity("hosts")?.readOnlyFields).toEqual(
      expect.arrayContaining(["connectionOrigin", "localOnly", "sharedSource"]),
    );
    expect(getEntity("userPreferences")?.readOnlyFields).toEqual([
      "storageMode",
    ]);
  });

  it("leaves local-only and shared rows out of what a device sends", () => {
    const hosts = getEntity("hosts")!;
    expect(hosts.shouldSync?.({ localOnly: true })).toBe(false);
    expect(hosts.shouldSync?.({ sharedSource: "{}" })).toBe(false);
    expect(hosts.shouldSync?.({ localOnly: false, sharedSource: null })).toBe(
      true,
    );
  });

  it("encrypts host and credential secrets", () => {
    expect(getEntity("hosts")?.encryptedFields).toContain("password");
    expect(getEntity("sshCredentials")?.encryptedFields).toContain(
      "privateKey",
    );
  });

  it("is idempotent, because several modules prime it", () => {
    const before = listEntityTypes();
    registerCoreSyncEntities();

    expect(listEntityTypes()).toEqual(before);
  });
});
