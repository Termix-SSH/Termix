import { describe, expect, it } from "vitest";
import {
  defaultUiPreferences,
  hasUiOverrides,
  PRESETS,
  resolveArea,
  sanitizeUiOverrides,
  sanitizeUiPreferences,
  UI_PREFERENCES_VERSION,
} from "@/types/ui-preferences";

describe("defaultUiPreferences", () => {
  it("starts every user on balanced with no overrides", () => {
    const defaults = defaultUiPreferences();
    expect(defaults.preset).toBe("balanced");
    expect(defaults.overrides).toEqual({});
    expect(defaults.onboarding).toEqual({
      completedVersion: 0,
      completedAt: null,
      skipped: false,
    });
  });
});

describe("sanitizeUiPreferences", () => {
  it("returns defaults for non-object input", () => {
    expect(sanitizeUiPreferences(null)).toEqual(defaultUiPreferences());
    expect(sanitizeUiPreferences(undefined)).toEqual(defaultUiPreferences());
    expect(sanitizeUiPreferences("nope")).toEqual(defaultUiPreferences());
  });

  it("round-trips a fully valid preferences object", () => {
    const valid = {
      version: UI_PREFERENCES_VERSION,
      preset: "simple" as const,
      overrides: { hostList: { density: "compact" as const, showTags: true } },
      onboarding: {
        completedVersion: 1,
        completedAt: "2026-01-01T00:00:00.000Z",
        skipped: false,
      },
    };
    expect(sanitizeUiPreferences(valid)).toEqual(valid);
  });

  it("falls back to the default preset for an unknown value", () => {
    expect(sanitizeUiPreferences({ preset: "ultra" }).preset).toBe("balanced");
  });

  it("always stamps the current version regardless of input", () => {
    expect(sanitizeUiPreferences({ version: 999 }).version).toBe(
      UI_PREFERENCES_VERSION,
    );
  });

  it("ignores a malformed onboarding block", () => {
    expect(sanitizeUiPreferences({ onboarding: "done" }).onboarding).toEqual({
      completedVersion: 0,
      completedAt: null,
      skipped: false,
    });
  });
});

describe("sanitizeUiOverrides", () => {
  it("drops unknown areas and unknown keys", () => {
    const result = sanitizeUiOverrides({
      notAnArea: { density: "compact" },
      hostList: { density: "compact", notAKnob: 42 },
    });
    expect(result).toEqual({ hostList: { density: "compact" } });
  });

  it("drops invalid values but keeps the valid siblings", () => {
    const result = sanitizeUiOverrides({
      hostList: {
        density: "enormous",
        showTags: "yes",
        showResourceBars: true,
      },
    });
    expect(result).toEqual({ hostList: { showResourceBars: true } });
  });

  it("prunes areas that end up empty so override checks stay honest", () => {
    const result = sanitizeUiOverrides({
      hostList: { density: "enormous" },
      terminal: {},
    });
    expect(result).toEqual({});
    expect(
      hasUiOverrides({ ...defaultUiPreferences(), overrides: result }),
    ).toBe(false);
  });

  it("filters non-strings out of string arrays instead of rejecting them", () => {
    const result = sanitizeUiOverrides({
      rail: { hiddenTabs: ["serial", 7, null, "history"] },
    });
    expect(result.rail?.hiddenTabs).toEqual(["serial", "history"]);
  });

  it("clamps and rounds integer knobs, dropping out-of-range values", () => {
    expect(sanitizeUiOverrides({ hostMetrics: { columns: 2.4 } })).toEqual({
      hostMetrics: { columns: 2 },
    });
    expect(sanitizeUiOverrides({ hostMetrics: { columns: 9 } })).toEqual({});
    expect(sanitizeUiOverrides({ hostMetrics: { columns: 0 } })).toEqual({});
  });

  it("keeps an explicit null for nullable array knobs", () => {
    expect(sanitizeUiOverrides({ homepage: { enabledWidgets: null } })).toEqual(
      {
        homepage: { enabledWidgets: null },
      },
    );
  });
});

describe("resolveArea", () => {
  it("returns preset values when there are no overrides", () => {
    const prefs = { ...defaultUiPreferences(), preset: "simple" as const };
    expect(resolveArea(prefs, "hostList")).toEqual(PRESETS.simple.hostList);
  });

  it("layers overrides on top of the preset", () => {
    const prefs = {
      ...defaultUiPreferences(),
      preset: "simple" as const,
      overrides: { hostList: { showTags: true } },
    };
    const resolved = resolveArea(prefs, "hostList");
    expect(resolved.showTags).toBe(true);
    expect(resolved.trayTrigger).toBe(PRESETS.simple.hostList.trayTrigger);
  });

  it("re-bases custom on balanced", () => {
    const prefs = {
      ...defaultUiPreferences(),
      preset: "custom" as const,
      overrides: { hostList: { density: "compact" as const } },
    };
    const resolved = resolveArea(prefs, "hostList");
    expect(resolved.density).toBe("compact");
    expect(resolved.trayTrigger).toBe(PRESETS.balanced.hostList.trayTrigger);
  });
});

describe("PRESETS.balanced", () => {
  // Balanced is the compatibility contract: it must equal the behavior that
  // shipped before presets existed, or every existing user sees a changed UI.
  it("matches the pre-preset defaults", () => {
    expect(PRESETS.balanced.hostList).toEqual({
      density: "comfortable",
      showTags: true,
      showResourceBars: true,
      showStatusStripes: true,
      trayTrigger: "always",
      rowActions: "full",
    });
    expect(PRESETS.balanced.rail.hiddenTabs).toEqual([]);
    expect(PRESETS.balanced.terminal.toolbarDensity).toBe("labeled");
    expect(PRESETS.balanced.fileManager.viewMode).toBe("grid");
    expect(PRESETS.balanced.docker.viewMode).toBe("list");
    expect(PRESETS.balanced.hostEditor.mode).toBe("full");
    expect(PRESETS.balanced.homepage.enabledWidgets).toBeNull();
  });

  it("never lets a preset drive the homepage canvas", () => {
    expect(PRESETS.simple.homepage.enabledWidgets).toBeNull();
    expect(PRESETS.advanced.homepage.enabledWidgets).toBeNull();
  });

  it("leaves the wide dashboard cards off by default in every preset", () => {
    // network_graph and homepage_preview overflow the dashboard width when
    // enabled up front. They stay in the Add card tray instead.
    for (const preset of ["simple", "balanced", "advanced"] as const) {
      expect(PRESETS[preset].dashboard.enabledCards).not.toContain(
        "network_graph",
      );
      expect(PRESETS[preset].dashboard.enabledCards).not.toContain(
        "homepage_preview",
      );
    }
  });
});
