import { describe, expect, it } from "vitest";
import syncRouter, {
  isValidEntityType,
  normalizeSince,
  stripWritePayload,
} from "../../../database/routes/sync.js";

describe("sync route registration order", () => {
  // Express matches in registration order and "tombstones" is a perfectly
  // good :entityType value, so a POST /:entityType registered first swallows
  // POST /sync/tombstones and answers it with 400 "Unknown entity type".
  const paths = (
    syncRouter as unknown as {
      stack: { route?: { path: string; methods: Record<string, boolean> } }[];
    }
  ).stack
    .filter((layer) => layer.route?.methods.post)
    .map((layer) => layer.route!.path);

  it("registers POST /tombstones before the POST /:entityType wildcard", () => {
    expect(paths).toContain("/tombstones");
    expect(paths).toContain("/:entityType");
    expect(paths.indexOf("/tombstones")).toBeLessThan(
      paths.indexOf("/:entityType"),
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

describe("normalizeSince", () => {
  it("rewrites an ISO cursor into the shape CURRENT_TIMESTAMP stores", () => {
    expect(normalizeSince("2026-07-29T10:06:55.172Z")).toBe(
      "2026-07-29 10:06:55",
    );
  });

  it("makes a newer row win the lexical comparison against the cursor", () => {
    // The bug: a row written five minutes after the cursor still compared as
    // older, because ' ' (0x20) sorts below 'T' (0x54) at position 10.
    const storedRow = "2026-07-29 10:11:21";
    const rawCursor = "2026-07-29T10:06:55.172Z";
    expect(storedRow > rawCursor).toBe(false);
    expect(storedRow > normalizeSince(rawCursor)!).toBe(true);
  });

  it("keeps a Postgres timestamp with fraction and offset above the cursor", () => {
    expect(
      "2026-07-29 10:06:55.123456+00" >
        normalizeSince("2026-07-29T10:06:55.172Z")!,
    ).toBe(true);
  });

  it("treats a missing, empty, or unparsable cursor as no filter", () => {
    expect(normalizeSince(undefined)).toBeNull();
    expect(normalizeSince("")).toBeNull();
    expect(normalizeSince("not a date")).toBeNull();
    expect(normalizeSince(1753783615172)).toBeNull();
  });

  it("is idempotent, so an already-normalized cursor survives a round trip", () => {
    expect(normalizeSince("2026-07-29 10:06:55")).toBe("2026-07-29 10:06:55");
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
