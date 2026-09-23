import { afterEach, describe, expect, it } from "vitest";
import syncRouter, {
  isSyncedRow,
  isValidEntityType,
  stripWritePayload,
} from "../../../database/routes/sync.js";
import { registerEntity } from "../../../plugins/sync-registry.js";

describe("sync route order", () => {
  it("registers POST /tombstones before the POST /:entityType wildcard", () => {
    const postPaths = (
      syncRouter as unknown as {
        stack: Array<{ route?: { path: string; methods: { post?: boolean } } }>;
      }
    ).stack
      .filter((layer) => layer.route?.methods?.post)
      .map((layer) => layer.route!.path);

    // "/tombstones" is a valid value for :entityType as far as Express is
    // concerned, so registering the wildcard first makes the tombstone
    // endpoint unreachable -- every deletion push answers 400 "Unknown entity
    // type" instead of applying the deletion.
    expect(postPaths).toContain("/tombstones");
    expect(postPaths.indexOf("/tombstones")).toBeLessThan(
      postPaths.indexOf("/:entityType"),
    );
  });
});

describe("isValidEntityType", () => {
  it("accepts every whitelisted sync entity type", () => {
    for (const type of [
      "hosts",
      "sshCredentials",
      "sshFolders",
      "snippets",
      "snippetFolders",
      "vaultProfiles",
      "dashboardServiceLinks",
      "homepageItems",
      "userPreferences",
    ]) {
      expect(isValidEntityType(type)).toBe(true);
    }
  });

  it("rejects unknown or non-string entity types", () => {
    expect(isValidEntityType("hostAccess")).toBe(false);
    expect(isValidEntityType("")).toBe(false);
    expect(isValidEntityType(undefined)).toBe(false);
    expect(isValidEntityType(42)).toBe(false);
  });
});

describe("stripWritePayload", () => {
  it("strips id, userId, and syncId from every entity type", () => {
    const payload = {
      id: 1,
      userId: "user-1",
      syncId: "abc",
      name: "prod-db",
    };
    expect(stripWritePayload("sshFolders", payload)).toEqual({
      name: "prod-db",
    });
  });

  it("also strips desktop-only fields flagged read-only for hosts", () => {
    const payload = {
      id: 1,
      userId: "user-1",
      syncId: "abc",
      name: "web",
      connectionOrigin: "remote",
    };
    expect(stripWritePayload("hosts", payload)).toEqual({ name: "web" });
  });

  it("keeps preference storage mode local to each device", () => {
    expect(
      stripWritePayload("userPreferences", {
        syncId: "userPreferences:singleton",
        theme: "dark",
        storageMode: "cloud",
      }),
    ).toEqual({ theme: "dark" });
  });

  it("does not mutate the original payload object", () => {
    const payload = { id: 1, userId: "user-1", syncId: "abc", name: "x" };
    stripWritePayload("snippets", payload);
    expect(payload).toEqual({
      id: 1,
      userId: "user-1",
      syncId: "abc",
      name: "x",
    });
  });
});

describe("isSyncedRow", () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it("syncs every row of an entity that does not filter", () => {
    expect(isSyncedRow("hosts", { id: 1 })).toBe(true);
  });

  it("leaves out the rows an entity's shouldSync refuses", () => {
    dispose = registerEntity("demo", {
      type: "demoLayouts",
      table: {},
      shouldSync: (row) => row.kind !== "local",
    });
    expect(isSyncedRow("demoLayouts", { kind: "shared" })).toBe(true);
    expect(isSyncedRow("demoLayouts", { kind: "local" })).toBe(false);
  });
});
