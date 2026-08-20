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

export const UI_PREFERENCES_VERSION = 1;

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
  | "docker"
  | "hostMetrics"
  | "hostEditor"
  | "homepage";

export type UiDensity = "comfortable" | "compact";
export type UiTrayTrigger = "always" | "hover" | "click" | "actionsOnly";
export type UiRowActions = "essential" | "full";
export type UiEmptyStateVerbosity = "minimal" | "guided";
export type UiToolbarDensity = "icon" | "labeled" | "expanded";
export type UiFileViewMode = "grid" | "list";
export type UiDockerViewMode = "list" | "detail";
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

export interface UiDockerPreferences {
  viewMode: UiDockerViewMode;
}

export interface UiHostMetricsPreferences {
  enabledCards: string[];
  columns: number;
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
  docker: UiDockerPreferences;
  hostMetrics: UiHostMetricsPreferences;
  hostEditor: UiHostEditorPreferences;
  homepage: UiHomepagePreferences;
}

export type UiOverrides = {
  [A in UiAreaKey]?: Partial<UiAreaPreferences[A]>;
};

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
  "alerts",
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

/** Host metrics card ids, mirroring CARD_DEFINITIONS in features/host-metrics/cards. */
const SIMPLE_HOST_METRICS_CARDS = ["cpu", "memory", "disk"];
const BALANCED_HOST_METRICS_CARDS = [
  "cpu",
  "memory",
  "disk",
  "network",
  "uptime",
  "system",
];
const ADVANCED_HOST_METRICS_CARDS = [
  ...BALANCED_HOST_METRICS_CARDS,
  "login_stats",
  "ports",
  "processes",
  "firewall",
  "temperature",
];

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
    docker: { viewMode: "list" },
    hostMetrics: { enabledCards: SIMPLE_HOST_METRICS_CARDS, columns: 1 },
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
    docker: { viewMode: "list" },
    // 3 is defaultLayoutFromWidgets's own default, i.e. today's behavior.
    hostMetrics: { enabledCards: BALANCED_HOST_METRICS_CARDS, columns: 3 },
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
    docker: { viewMode: "detail" },
    hostMetrics: { enabledCards: ADVANCED_HOST_METRICS_CARDS, columns: 4 },
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
  docker: {
    viewMode: { kind: "enum", values: ["list", "detail"] },
  },
  hostMetrics: {
    enabledCards: { kind: "stringArray" },
    columns: { kind: "int", min: 1, max: 4 },
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
export function sanitizeUiOverrides(input: unknown): UiOverrides {
  const out: Record<string, Record<string, unknown>> = {};
  if (!input || typeof input !== "object") return out as UiOverrides;

  const specsByArea = AREA_SPECS as unknown as Record<
    string,
    Record<string, FieldSpec>
  >;

  for (const [area, areaValue] of Object.entries(
    input as Record<string, unknown>,
  )) {
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
    overrides: sanitizeUiOverrides(obj.overrides),
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
