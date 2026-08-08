import { describe, expect, it } from "vitest";
import {
  HOST_SIDEBAR_PREFS_VERSION,
  defaultHostSidebarPreferences,
  sanitizeHostSidebarPreferences,
} from "@/types/host-sidebar-preferences";

describe("defaultHostSidebarPreferences", () => {
  it("returns a fully populated default shape", () => {
    const defaults = defaultHostSidebarPreferences();
    expect(defaults).toEqual({
      version: HOST_SIDEBAR_PREFS_VERSION,
      sort: { key: "default", pinnedFirst: false },
      groupKey: "folder",
      filters: {
        status: [],
        authType: [],
        protocol: [],
        features: [],
        tags: [],
      },
      openFolders: [],
      display: {
        density: "comfortable",
        showTags: true,
        trayTrigger: "always",
        statusColorScheme: "accent",
      },
    });
  });
});

describe("sanitizeHostSidebarPreferences", () => {
  it("returns defaults for non-object input", () => {
    expect(sanitizeHostSidebarPreferences(null)).toEqual(
      defaultHostSidebarPreferences(),
    );
    expect(sanitizeHostSidebarPreferences(undefined)).toEqual(
      defaultHostSidebarPreferences(),
    );
    expect(sanitizeHostSidebarPreferences("nope")).toEqual(
      defaultHostSidebarPreferences(),
    );
  });

  it("round-trips a fully valid preferences object", () => {
    const valid = {
      version: 1,
      sort: { key: "manual", pinnedFirst: true },
      groupKey: "tag",
      filters: {
        status: ["online"],
        authType: ["key"],
        protocol: ["ssh"],
        features: ["terminal"],
        tags: ["prod"],
      },
      openFolders: ["Production", "Production / Web"],
      display: {
        density: "compact",
        showTags: false,
        trayTrigger: "click",
        statusColorScheme: "status",
      },
    };
    expect(sanitizeHostSidebarPreferences(valid)).toEqual(valid);
  });

  it("falls back to defaults for invalid enum values", () => {
    const result = sanitizeHostSidebarPreferences({
      sort: { key: "not-a-real-key", pinnedFirst: "yes" },
      groupKey: "bogus",
      display: { density: "huge", trayTrigger: "double-click" },
    });
    expect(result.sort).toEqual({ key: "default", pinnedFirst: false });
    expect(result.groupKey).toBe("folder");
    expect(result.display.density).toBe("comfortable");
    expect(result.display.trayTrigger).toBe("always");
  });

  it("filters out invalid entries from filter arrays instead of rejecting them", () => {
    const result = sanitizeHostSidebarPreferences({
      filters: {
        status: ["online", "bogus", "pinned"],
        authType: ["key", "nope"],
        tags: ["prod", 42, null],
      },
    });
    expect(result.filters.status).toEqual(["online", "pinned"]);
    expect(result.filters.authType).toEqual(["key"]);
    expect(result.filters.tags).toEqual(["prod"]);
  });

  it("drops non-string entries from openFolders", () => {
    const result = sanitizeHostSidebarPreferences({
      openFolders: ["Production", 123, null, "Staging"],
    });
    expect(result.openFolders).toEqual(["Production", "Staging"]);
  });

  it("always stamps the current version regardless of input", () => {
    const result = sanitizeHostSidebarPreferences({ version: 999 });
    expect(result.version).toBe(HOST_SIDEBAR_PREFS_VERSION);
  });
});
