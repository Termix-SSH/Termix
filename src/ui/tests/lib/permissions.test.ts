import { describe, expect, it } from "vitest";
import { matchesPermission } from "@/lib/permissions";

/**
 * These cases mirror PermissionManager.hasPermission on the backend. If that
 * changes, this file is the tripwire.
 */
describe("matchesPermission", () => {
  it("grants on an exact match", () => {
    expect(
      matchesPermission(["ai.services.use"], false, "ai.services.use"),
    ).toBe(true);
  });

  it("grants on the superuser wildcard", () => {
    expect(matchesPermission(["*"], false, "anything.at.all")).toBe(true);
  });

  it("grants on each dotted wildcard level", () => {
    expect(matchesPermission(["ai.services.*"], false, "ai.services.use")).toBe(
      true,
    );
    expect(matchesPermission(["ai.*"], false, "ai.services.use")).toBe(true);
  });

  it("grants to an admin with no explicit permissions", () => {
    expect(matchesPermission([], true, "ai.services.use")).toBe(true);
  });

  it("denies a non-admin without a matching grant", () => {
    expect(matchesPermission([], false, "ai.services.use")).toBe(false);
    expect(matchesPermission(["hosts.view"], false, "ai.services.use")).toBe(
      false,
    );
  });

  it("does not treat a prefix as a wildcard without the star", () => {
    expect(matchesPermission(["ai.services"], false, "ai.services.use")).toBe(
      false,
    );
  });

  it("does not let a sibling wildcard grant an unrelated permission", () => {
    expect(matchesPermission(["hosts.*"], false, "ai.services.use")).toBe(
      false,
    );
  });

  it("handles a single-segment permission", () => {
    expect(matchesPermission(["admin"], false, "admin")).toBe(true);
    // "admin.*" covers bare "admin" too: the backend builds the same
    // single-segment wildcard, so the frontend must agree.
    expect(matchesPermission(["admin.*"], false, "admin")).toBe(true);
    expect(matchesPermission(["other"], false, "admin")).toBe(false);
  });
});
