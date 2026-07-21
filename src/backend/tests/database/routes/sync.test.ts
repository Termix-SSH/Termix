import { describe, expect, it } from "vitest";
import {
  isValidEntityType,
  stripWritePayload,
} from "../../../database/routes/sync.js";

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
