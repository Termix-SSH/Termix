import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_SIDEBAR_PREFS_VERSION,
  defaultCredentialSidebarPreferences,
  sanitizeCredentialSidebarPreferences,
} from "@/types/credential-sidebar-preferences";

describe("defaultCredentialSidebarPreferences", () => {
  it("returns a fully populated default shape", () => {
    const defaults = defaultCredentialSidebarPreferences();
    expect(defaults).toEqual({
      version: CREDENTIAL_SIDEBAR_PREFS_VERSION,
      sort: { key: "default", pinnedFirst: false },
      filters: {
        type: [],
        tags: [],
      },
      openFolders: [],
      display: {
        density: "comfortable",
        showTags: true,
        trayTrigger: "always",
      },
    });
  });
});

describe("sanitizeCredentialSidebarPreferences", () => {
  it("returns defaults for non-object input", () => {
    expect(sanitizeCredentialSidebarPreferences(null)).toEqual(
      defaultCredentialSidebarPreferences(),
    );
    expect(sanitizeCredentialSidebarPreferences(undefined)).toEqual(
      defaultCredentialSidebarPreferences(),
    );
    expect(sanitizeCredentialSidebarPreferences("nope")).toEqual(
      defaultCredentialSidebarPreferences(),
    );
  });

  it("round-trips a fully valid preferences object", () => {
    const valid = {
      version: 1,
      sort: { key: "manual", pinnedFirst: true },
      filters: {
        type: ["key"],
        tags: ["prod"],
      },
      openFolders: ["Production", "Staging"],
      display: {
        density: "compact",
        showTags: false,
        trayTrigger: "click",
      },
    };
    expect(sanitizeCredentialSidebarPreferences(valid)).toEqual(valid);
  });

  it("falls back to defaults for invalid enum values", () => {
    const result = sanitizeCredentialSidebarPreferences({
      sort: { key: "not-a-real-key", pinnedFirst: "yes" },
      display: { density: "huge", trayTrigger: "double-click" },
    });
    expect(result.sort).toEqual({ key: "default", pinnedFirst: false });
    expect(result.display.density).toBe("comfortable");
    expect(result.display.trayTrigger).toBe("always");
  });

  it("filters out invalid entries from filter arrays instead of rejecting them", () => {
    const result = sanitizeCredentialSidebarPreferences({
      filters: {
        type: ["key", "bogus"],
        tags: ["prod", 42, null],
      },
    });
    expect(result.filters.type).toEqual(["key"]);
    expect(result.filters.tags).toEqual(["prod"]);
  });

  it("drops non-string entries from openFolders", () => {
    const result = sanitizeCredentialSidebarPreferences({
      openFolders: ["Production", 123, null, "Staging"],
    });
    expect(result.openFolders).toEqual(["Production", "Staging"]);
  });

  it("always stamps the current version regardless of input", () => {
    const result = sanitizeCredentialSidebarPreferences({ version: 999 });
    expect(result.version).toBe(CREDENTIAL_SIDEBAR_PREFS_VERSION);
  });
});
