import { describe, expect, it } from "vitest";
import { PERSISTENT_TAB_TYPES } from "@/AppShell";

describe("PERSISTENT_TAB_TYPES", () => {
  it("excludes web-endpoint", () => {
    // Not merely scope. The backend closes an idle tunnel after ten minutes
    // and re-binds a fresh kernel-assigned port on the next open, so a
    // restored web-endpoint tab could never hold a valid URL -- and the
    // endpoint may have been edited or deleted meanwhile besides. Restoring
    // one would mean re-opening the tunnel on restore, which is a feature.
    //
    // This test exists so nobody adds it later for symmetry and ships tabs
    // that restore broken.
    expect(PERSISTENT_TAB_TYPES).not.toContain("web-endpoint");
  });

  it("still persists the tab types that can be restored", () => {
    // Guards the guard: an empty or gutted list would pass the assertion above
    // vacuously.
    expect(PERSISTENT_TAB_TYPES).toContain("terminal");
    expect(PERSISTENT_TAB_TYPES).toContain("tunnel");
    expect(PERSISTENT_TAB_TYPES.length).toBeGreaterThanOrEqual(8);
  });
});
