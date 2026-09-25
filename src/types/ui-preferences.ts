/**
 * App-wide UI complexity preferences. Shared by the frontend UI preferences
 * context and the backend preferences endpoint (no framework imports, mirrors
 * ./host-sidebar-preferences.ts's dependency-free convention -- the backend's
 * NodeNext build cannot resolve the "@/" frontend path alias).
 *
 * The model stores the user's *intent* -- a preset plus the individual knobs
 * they have deliberately changed -- not a second copy of values other stores
 * already own. Areas whose knobs already live somewhere else (host sidebar
 * blob, user_preferences.hiddenRailTabs, a handful of localStorage keys) are
 * seeded from the preset when it changes; reads keep going to the existing
 * store. See applyPresetSideEffects on the frontend.
 *
 * "balanced" is exactly today's behavior. Every value in PRESETS.balanced is
 * transcribed from the defaults that were already in the code, so existing
 * users who land on it see no change at all.
 */

/** 2: the docker and host metrics areas moved to their plugins. */
export const UI_PREFERENCES_VERSION = 2;

/** Bump when onboarding gains steps existing users should be shown again. */
export const UI_ONBOARDING_VERSION = 2;

export type UiPreset = "simple" | "balanced" | "advanced" | "custom";

export type UiAreaKey =
  | "chrome"
  | "hostList"
  | "credentialList"
  | "rail"
  | "dashboard"
  | "terminal"
  | "fileManager"
  | "hostEditor"
  | "homepage";

/**
 * The homepage area key, named rather than spelled inline in src/ui: it
 * happens to share its spelling with the homepage plugin's id, which
 * scripts/check-shell-plugin-ids.cjs treats as a plugin id wherever it sees
 * that literal under src/ui. This area predates plugins and is unrelated -
 * it is core's own widget-visibility override, not the plugin.
 */
export const HOMEPAGE_AREA_KEY: UiAreaKey = "homepage";

export type UiDensity = "comfortable" | "compact";
export type UiTrayTrigger = "always" | "hover" | "click" | "actionsOnly";
export type UiRowActions = "essential" | "full";
export type UiEmptyStateVerbosity = "minimal" | "guided";
export type UiToolbarDensity = "icon" | "labeled" | "expanded";
export type UiFileViewMode = "grid" | "list";
export type UiHostEditorMode = "simple" | "full";

export interface UiChromePreferences {
  showBreadcrumbs: boolean;
  showStatusBar: boolean;
  emptyStateVerbosity: UiEmptyStateVerbosity;
}

export interface UiHostListPreferences {
  density: UiDensity;
  showTags: boolean;
  showResourceBars: boolean;
  showStatusStripes: boolean;
  trayTrigger: UiTrayTrigger;
  rowActions: UiRowActions;
}

export interface UiCredentialListPreferences {
  density: UiDensity;
  showTags: boolean;
}

export interface UiRailPreferences {
  hiddenTabs: string[];
}

export interface UiDashboardPreferences {
  enabledCards: string[];
}

export interface UiTerminalPreferences {
  toolbarDensity: UiToolbarDensity;
}

export interface UiFileManagerPreferences {
  viewMode: UiFileViewMode;
  showHiddenFiles: boolean;
}

export interface UiHostEditorPreferences {
  mode: UiHostEditorMode;
}

export interface UiHomepagePreferences {
  /** null means "never preset-driven" -- a preset must not touch the canvas. */
  enabledWidgets: string[] | null;
}

export interface UiAreaPreferences {
  chrome: UiChromePreferences;
  hostList: UiHostListPreferences;
  credentialList: UiCredentialListPreferences;
  rail: UiRailPreferences;
  dashboard: UiDashboardPreferences;
  terminal: UiTerminalPreferences;
  fileManager: UiFileManagerPreferences;
  hostEditor: UiHostEditorPreferences;
  homepage: UiHomepagePreferences;
}

/** A plugin's own area, keyed "plugin:<id>", holding what it declared in contributes.uiPresets. */
export type UiPluginAreaKey = `plugin:${string}`;

export type UiOverrides = {
  [A in UiAreaKey]?: Partial<UiAreaPreferences[A]>;
} & { [key: UiPluginAreaKey]: Record<string, unknown> };

export interface UiOnboardingState {
  /** 0 means "never completed". Compared against UI_ONBOARDING_VERSION. */
  completedVersion: number;
  completedAt: string | null;
  skipped: boolean;
}

export interface UiPreferences {
  version: number;
  preset: UiPreset;
  overrides: UiOverrides;
  onboarding: UiOnboardingState;
}

const PRESET_VALUES: UiPreset[] = ["simple", "balanced", "advanced", "custom"];

/**
 * Rail views Simple keeps. Cutting all the way down to hosts+credentials makes
 * the app feel broken, so connections and snippets stay: snippets is the most
 * approachable power feature and connections is where troubleshooting starts.
 */
const SIMPLE_RAIL_VISIBLE = ["hosts", "credentials", "connections", "snippets"];

/** Every hideable rail view, mirroring HideableRailView in sidebar/AppRail.tsx. */
const ALL_HIDEABLE_RAIL_VIEWS = [
  "hosts",
  "credentials",
  "termix-id",
  "quick-connect",
  "serial",
  "ssh-tools",
  "snippets",
  "macros",
  "history",
  "split-screen",
  "connections",
  "session-logs",
  "fleets",
  "workspaces",
  "network_graph",
  "homepage",
  "ai",
];

const SIMPLE_HIDDEN_RAIL_TABS = ALL_HIDEABLE_RAIL_VIEWS.filter(
  (view) => !SIMPLE_RAIL_VISIBLE.includes(view),
);

/** Dashboard card ids, mirroring DASHBOARD_CARDS in ui/lib/theme.ts. */
const BALANCED_DASHBOARD_CARDS = [
  "stats_bar",
  "counters_bar",
  "quick_actions",
  "host_status",
  "recent_activity",
];
// Advanced adds service links but leaves network_graph and homepage_preview
// off: both are wide, and enabling them by default pushes the dashboard past
// the edge of the screen. They stay available in the Add card tray.
const ADVANCED_DASHBOARD_CARDS = [...BALANCED_DASHBOARD_CARDS, "service_links"];

export const PRESETS: Record<Exclude<UiPreset, "custom">, UiAreaPreferences> = {
  simple: {
    chrome: {
      showBreadcrumbs: false,
      showStatusBar: false,
      emptyStateVerbosity: "guided",
    },
    hostList: {
      density: "comfortable",
      showTags: false,
      showResourceBars: false,
      showStatusStripes: false,
      // "always" permanently renders the management row and resource bars,
      // which is the wall of buttons the issue calls intimidating.
      trayTrigger: "actionsOnly",
      rowActions: "essential",
    },
    credentialList: { density: "comfortable", showTags: false },
    rail: { hiddenTabs: SIMPLE_HIDDEN_RAIL_TABS },
    dashboard: {
      enabledCards: [
        "stats_bar",
        "counters_bar",
        "quick_actions",
        "host_status",
      ],
    },
    terminal: { toolbarDensity: "icon" },
    fileManager: { viewMode: "grid", showHiddenFiles: false },
    hostEditor: { mode: "simple" },
    homepage: { enabledWidgets: null },
  },
  balanced: {
    chrome: {
      showBreadcrumbs: true,
      showStatusBar: true,
      emptyStateVerbosity: "minimal",
    },
    hostList: {
      density: "comfortable",
      showTags: true,
      showResourceBars: true,
      showStatusStripes: true,
      trayTrigger: "always",
      rowActions: "full",
    },
    credentialList: { density: "comfortable", showTags: true },
    rail: { hiddenTabs: [] },
    dashboard: { enabledCards: BALANCED_DASHBOARD_CARDS },
    terminal: { toolbarDensity: "labeled" },
    // FileManager.tsx has always defaulted to grid when nothing is stored.
    fileManager: { viewMode: "grid", showHiddenFiles: false },
    // 3 is defaultLayoutFromWidgets's own default, i.e. today's behavior.
    hostEditor: { mode: "full" },
    homepage: { enabledWidgets: null },
  },
  advanced: {
    chrome: {
      showBreadcrumbs: true,
      showStatusBar: true,
      emptyStateVerbosity: "minimal",
    },
    hostList: {
      density: "compact",
      showTags: true,
      showResourceBars: true,
      showStatusStripes: true,
      trayTrigger: "always",
      rowActions: "full",
    },
    credentialList: { density: "compact", showTags: true },
    rail: { hiddenTabs: [] },
    dashboard: { enabledCards: ADVANCED_DASHBOARD_CARDS },
    terminal: { toolbarDensity: "expanded" },
    // List packs more files and metadata per screen than the grid.
    fileManager: { viewMode: "list", showHiddenFiles: true },
    hostEditor: { mode: "full" },
    homepage: { enabledWidgets: null },
  },
};

type FieldSpec =
  | { kind: "enum"; values: readonly string[] }
  | { kind: "bool" }
  | { kind: "int"; min: number; max: number }
  | { kind: "stringArray" }
  | { kind: "nullableStringArray" };

/**
 * Field descriptors for every area knob. Unlike the flat sanitizers on the
 * sidebar preference blobs, overrides are a sparse two-level map, so one table
 * drives both levels instead of a ternary per field.
 */
const AREA_SPECS: {
  [A in UiAreaKey]: Record<keyof UiAreaPreferences[A] & string, FieldSpec>;
} = {
  chrome: {
    showBreadcrumbs: { kind: "bool" },
    showStatusBar: { kind: "bool" },
    emptyStateVerbosity: { kind: "enum", values: ["minimal", "guided"] },
  },
  hostList: {
    density: { kind: "enum", values: ["comfortable", "compact"] },
    showTags: { kind: "bool" },
    showResourceBars: { kind: "bool" },
    showStatusStripes: { kind: "bool" },
    trayTrigger: {
      kind: "enum",
      values: ["always", "hover", "click", "actionsOnly"],
    },
    rowActions: { kind: "enum", values: ["essential", "full"] },
  },
  credentialList: {
    density: { kind: "enum", values: ["comfortable", "compact"] },
    showTags: { kind: "bool" },
  },
  rail: {
    hiddenTabs: { kind: "stringArray" },
  },
  dashboard: {
    enabledCards: { kind: "stringArray" },
  },
  terminal: {
    toolbarDensity: {
      kind: "enum",
      values: ["icon", "labeled", "expanded"],
    },
  },
  fileManager: {
    viewMode: { kind: "enum", values: ["grid", "list"] },
    showHiddenFiles: { kind: "bool" },
  },
  hostEditor: {
    mode: { kind: "enum", values: ["simple", "full"] },
  },
  homepage: {
    enabledWidgets: { kind: "nullableStringArray" },
  },
};

export const UI_AREA_KEYS = Object.keys(AREA_SPECS) as UiAreaKey[];

/** Returns undefined when the value fails its spec, so callers can drop it. */
function coerce(spec: FieldSpec, value: unknown): unknown | undefined {
  switch (spec.kind) {
    case "bool":
      return typeof value === "boolean" ? value : undefined;
    case "enum":
      return typeof value === "string" && spec.values.includes(value)
        ? value
        : undefined;
    case "int": {
      if (typeof value !== "number" || !Number.isFinite(value))
        return undefined;
      const rounded = Math.round(value);
      if (rounded < spec.min || rounded > spec.max) return undefined;
      return rounded;
    }
    case "stringArray":
      return Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : undefined;
    case "nullableStringArray":
      if (value === null) return null;
      return Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : undefined;
  }
}

/**
 * Drops unknown areas, unknown keys and invalid values, then prunes areas that
 * ended up empty. The pruning matters: it keeps
 * Object.keys(overrides).length > 0 an honest "has customizations" check for
 * the settings UI rather than something that accumulates {hostList:{}} noise.
 */
const PLUGIN_AREA_PATTERN = /^plugin:[a-z][a-z0-9-]{0,63}$/;
const PLUGIN_AREA_MAX_KEYS = 32;

/**
 * A plugin area's values are only checked for shape: core does not know the
 * plugin's fields, and the plugin reads them against its own presets.
 */
function sanitizePluginArea(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!input || typeof input !== "object") return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= PLUGIN_AREA_MAX_KEYS) break;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) continue;
    if (
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value)) ||
      (typeof value === "string" && value.length <= 200)
    ) {
      out[key] = value;
    } else if (
      Array.isArray(value) &&
      value.length <= 100 &&
      value.every((item) => typeof item === "string" && item.length <= 200)
    ) {
      out[key] = [...value];
    }
  }
  return out;
}

/** Version 1 stored the docker and host metrics areas under core names. */
const LEGACY_PLUGIN_AREAS: Record<string, UiPluginAreaKey> = {
  docker: "plugin:docker",
  hostMetrics: "plugin:host-metrics",
};

export function sanitizeUiOverrides(
  input: unknown,
  version = UI_PREFERENCES_VERSION,
): UiOverrides {
  const out: Record<string, Record<string, unknown>> = {};
  if (!input || typeof input !== "object") return out as UiOverrides;

  if (version < 2) {
    const upgraded = { ...(input as Record<string, unknown>) };
    for (const [legacy, area] of Object.entries(LEGACY_PLUGIN_AREAS)) {
      if (legacy in upgraded) {
        upgraded[area] = upgraded[legacy];
        delete upgraded[legacy];
      }
    }
    input = upgraded;
  }

  const specsByArea = AREA_SPECS as unknown as Record<
    string,
    Record<string, FieldSpec>
  >;

  for (const [area, areaValue] of Object.entries(
    input as Record<string, unknown>,
  )) {
    if (PLUGIN_AREA_PATTERN.test(area)) {
      const bucket = sanitizePluginArea(areaValue);
      if (Object.keys(bucket).length > 0) out[area] = bucket;
      continue;
    }
    const specs = specsByArea[area];
    if (!specs || !areaValue || typeof areaValue !== "object") continue;

    const bucket: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(
      areaValue as Record<string, unknown>,
    )) {
      const spec = specs[key];
      if (!spec) continue;
      const value = coerce(spec, raw);
      if (value !== undefined) bucket[key] = value;
    }

    if (Object.keys(bucket).length > 0) out[area] = bucket;
  }

  return out as UiOverrides;
}

function sanitizeOnboarding(input: unknown): UiOnboardingState {
  const defaults: UiOnboardingState = {
    completedVersion: 0,
    completedAt: null,
    skipped: false,
  };
  if (!input || typeof input !== "object") return defaults;
  const obj = input as Record<string, unknown>;

  return {
    completedVersion:
      typeof obj.completedVersion === "number" &&
      Number.isFinite(obj.completedVersion) &&
      obj.completedVersion >= 0
        ? Math.round(obj.completedVersion)
        : defaults.completedVersion,
    completedAt:
      typeof obj.completedAt === "string"
        ? obj.completedAt
        : defaults.completedAt,
    skipped: typeof obj.skipped === "boolean" ? obj.skipped : defaults.skipped,
  };
}

export function defaultUiPreferences(): UiPreferences {
  return {
    version: UI_PREFERENCES_VERSION,
    preset: "balanced",
    overrides: {},
    onboarding: { completedVersion: 0, completedAt: null, skipped: false },
  };
}

export function sanitizeUiPreferences(input: unknown): UiPreferences {
  const defaults = defaultUiPreferences();
  if (!input || typeof input !== "object") return defaults;
  const obj = input as Record<string, unknown>;

  return {
    version: UI_PREFERENCES_VERSION,
    preset: PRESET_VALUES.includes(obj.preset as UiPreset)
      ? (obj.preset as UiPreset)
      : defaults.preset,
    overrides: sanitizeUiOverrides(
      obj.overrides,
      typeof obj.version === "number" ? obj.version : 1,
    ),
    onboarding: sanitizeOnboarding(obj.onboarding),
  };
}

/**
 * Effective values for one area: preset defaults with the user's overrides
 * layered on top. "custom" only labels a diverged state, so it re-bases on
 * balanced rather than carrying a fourth value table.
 */
export function resolveArea<A extends UiAreaKey>(
  preferences: UiPreferences,
  area: A,
): UiAreaPreferences[A] {
  const base =
    PRESETS[preferences.preset === "custom" ? "balanced" : preferences.preset][
      area
    ];
  const override = preferences.overrides[area];
  return override ? { ...base, ...override } : base;
}

/** The presets a plugin declares in contributes.uiPresets. */
export type UiPluginPresets = Record<
  Exclude<UiPreset, "custom">,
  Record<string, unknown>
>;

/** A plugin area's values: its preset for the user's level, then overrides. */
export function resolvePluginArea(
  preferences: UiPreferences,
  pluginId: string,
  presets: UiPluginPresets | undefined,
): Record<string, unknown> {
  const level =
    preferences.preset === "custom" ? "balanced" : preferences.preset;
  const base = presets?.[level] ?? {};
  const override = (
    preferences.overrides as Record<string, Record<string, unknown>>
  )[`plugin:${pluginId}`];
  return override ? { ...base, ...override } : { ...base };
}

export function hasUiOverrides(preferences: UiPreferences): boolean {
  return Object.keys(preferences.overrides).length > 0;
}

/**
 * What the settings UI should show as the active preset. "custom" is derived
 * rather than stored, so clearing every override automatically restores the
 * user's chosen preset instead of stranding them on a label.
 */
export function effectivePresetLabel(preferences: UiPreferences): UiPreset {
  if (preferences.preset === "custom") return "custom";
  return hasUiOverrides(preferences) ? "custom" : preferences.preset;
}
