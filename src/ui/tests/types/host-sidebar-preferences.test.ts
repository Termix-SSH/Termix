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
        openOnDoubleClick: false,
        showFolderPaths: true,
        hostClickBehavior: "newTab",
        barActions: {},
        showAddress: true,
        showUsername: true,
        showPort: false,
        showPinIcon: true,
        showSharedBadge: true,
        showBadges: true,
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
        openOnDoubleClick: true,
        showFolderPaths: false,
        hostClickBehavior: "focusExistingDoubleClickNew",
        barActions: { maintenance: true },
        showAddress: false,
        showUsername: false,
        showPort: true,
        showPinIcon: false,
        showSharedBadge: false,
        showBadges: true,
      },
    };
    expect(sanitizeHostSidebarPreferences(valid)).toEqual(valid);
  });

  it("defaults openOnDoubleClick to false when missing or not a boolean", () => {
    expect(
      sanitizeHostSidebarPreferences({ display: {} }).display.openOnDoubleClick,
    ).toBe(false);
    expect(
      sanitizeHostSidebarPreferences({ display: { openOnDoubleClick: "yes" } })
        .display.openOnDoubleClick,
    ).toBe(false);
  });

  it("defaults showFolderPaths to true when missing or not a boolean", () => {
    expect(
      sanitizeHostSidebarPreferences({ display: {} }).display.showFolderPaths,
    ).toBe(true);
    expect(
      sanitizeHostSidebarPreferences({ display: { showFolderPaths: "no" } })
        .display.showFolderPaths,
    ).toBe(true);
  });

  it("defaults hostClickBehavior to newTab when missing or invalid", () => {
    expect(
      sanitizeHostSidebarPreferences({ display: {} }).display.hostClickBehavior,
    ).toBe("newTab");
    expect(
      sanitizeHostSidebarPreferences({ display: { hostClickBehavior: "nope" } })
        .display.hostClickBehavior,
    ).toBe("newTab");
    expect(
      sanitizeHostSidebarPreferences({
        display: { hostClickBehavior: "focusExisting" },
      }).display.hostClickBehavior,
    ).toBe("focusExisting");
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
        authType: ["key", "corp-sso", "Not A Type!", 7],
        tags: ["prod", 42, null],
      },
    });
    expect(result.filters.status).toEqual(["online", "pinned"]);
    // Plugins add auth types, so any well-formed id is kept.
    expect(result.filters.authType).toEqual(["key", "corp-sso"]);
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

describe("barActions", () => {
  it("keeps boolean choices for valid action ids only", () => {
    const prefs = sanitizeHostSidebarPreferences({
      display: {
        barActions: {
          maintenance: true,
          "ai-agent": false,
          "Bad Id": true,
          docker: "yes",
        },
      },
    });
    expect(prefs.display.barActions).toEqual({
      maintenance: true,
      "ai-agent": false,
    });
  });

  it("defaults to no overrides", () => {
    expect(sanitizeHostSidebarPreferences({}).display.barActions).toEqual({});
    expect(
      sanitizeHostSidebarPreferences({ display: { barActions: [] } }).display
        .barActions,
    ).toEqual({});
  });
});

describe("row fields", () => {
  it("keeps boolean row field choices", () => {
    const prefs = sanitizeHostSidebarPreferences({
      display: { showAddress: false, showPort: true, showBadges: false },
    });
    expect(prefs.display.showAddress).toBe(false);
    expect(prefs.display.showPort).toBe(true);
    expect(prefs.display.showBadges).toBe(false);
    expect(prefs.display.showUsername).toBe(true);
  });

  it("falls back to defaults for non-boolean values", () => {
    const prefs = sanitizeHostSidebarPreferences({
      display: { showAddress: "no", showPort: 1 },
    });
    expect(prefs.display.showAddress).toBe(true);
    expect(prefs.display.showPort).toBe(false);
  });
});
