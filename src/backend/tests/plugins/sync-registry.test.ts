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
import { registerCoreSyncEntities } from "../../database/routes/sync-entities.js";
import { SYNCED_ENTITY_TYPES } from "../../../../electron/remote-sync-entities.cjs";

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

describe("core sync entities", () => {
  beforeEach(() => {
    registerCoreSyncEntities();
  });

  // The frozen array also lists networkTopology, snippets/snippetFolders and
  // dashboardServiceLinks/homepageItems, now registered by the
  // network-topology, snippets and homepage plugins rather than core.
  const PLUGIN_OWNED_TYPES = new Set([
    "networkTopology",
    "snippets",
    "snippetFolders",
    "dashboardServiceLinks",
    "homepageItems",
  ]);

  it("registers every core-owned entity the Electron client knows about", () => {
    const coreTypes = new Set(listEntityTypes());
    for (const type of SYNCED_ENTITY_TYPES) {
      if (PLUGIN_OWNED_TYPES.has(type)) continue;
      expect(coreTypes.has(type), type).toBe(true);
    }
  });

  it("keeps the dependency order the frozen Electron array encodes", () => {
    expect(listEntityTypes()).toEqual(
      [...SYNCED_ENTITY_TYPES].filter((type) => !PLUGIN_OWNED_TYPES.has(type)),
    );
  });

  it("owns all of them as core", () => {
    for (const entity of listEntities()) {
      expect(entity.owner).toBe(CORE_OWNER);
    }
  });

  it("sorts every reference target before the entity that points at it", () => {
    const order = new Map(
      listEntities().map((entity) => [entity.type, entity.order]),
    );

    for (const entity of listEntities()) {
      for (const reference of entity.references ?? []) {
        // A self-reference is ordered within the entity by orderSyncRows.
        if (reference.entityType === entity.type) continue;
        expect(
          order.get(reference.entityType),
          `${entity.type} -> ${reference.entityType}`,
        ).toBeLessThan(entity.order);
      }
    }
  });

  it("marks the one singleton and nothing else", () => {
    const singletons = listEntities()
      .filter((entity) => entity.singleton)
      .map((entity) => entity.type);

    expect(singletons.sort()).toEqual(["userPreferences"]);
  });

  it("keeps the read-only fields that must survive a sync payload", () => {
    expect(getEntity("hosts")?.readOnlyFields).toEqual(["connectionOrigin"]);
    expect(getEntity("userPreferences")?.readOnlyFields).toEqual([
      "storageMode",
    ]);
  });

  it("is idempotent, because several modules prime it", () => {
    const before = listEntityTypes();
    registerCoreSyncEntities();

    expect(listEntityTypes()).toEqual(before);
  });
});
