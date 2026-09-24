/**
 * Host sidebar preferences model. Shared by the frontend sidebar and the
 * backend preferences endpoint (no framework imports, mirrors
 * ./host-metrics.ts's dependency-free convention). Replaces the ~10
 * independent localStorage keys/custom events the sidebar used to manage
 * individually.
 *
 * SortKey and StatusColorScheme are duplicated here (rather than imported
 * from src/ui/sidebar/host-sort.ts / src/ui/hooks/use-status-color-scheme.ts)
 * because those files use the "@/" frontend path alias, which the backend's
 * NodeNext build cannot resolve. Keep the values below in sync with those
 * two files.
 */

export const HOST_SIDEBAR_PREFS_VERSION = 1;

export type SortKey =
  | "default"
  | "name-asc"
  | "name-desc"
  | "ip-asc"
  | "ip-desc"
  | "status-online"
  | "status-offline"
  | "manual";

export type StatusColorScheme = "accent" | "status";

export type HostGroupKey = "folder" | "tag" | "status" | "protocol" | "auth";

export type HostDensity = "comfortable" | "compact";

export type HostTrayTrigger = "always" | "hover" | "click" | "actionsOnly";

export interface HostSidebarFilterState {
  status: ("online" | "offline" | "pinned")[];
  /** SSH auth type ids; plugins add their own. */
  authType: string[];
  /** "ssh" or a plugin protocol id. */
  protocol: string[];
  features: ("terminal" | "fileManager" | "tunnel" | "docker")[];
  tags: string[];
}

export interface HostSidebarDisplayPreferences {
  density: HostDensity;
  showTags: boolean;
  trayTrigger: HostTrayTrigger;
  statusColorScheme: StatusColorScheme;
  /** When true, a host row needs a double click to launch its session. */
  openOnDoubleClick: boolean;
  /** When false, nested folders hide the parent-path breadcrumb before their name. */
  showFolderPaths: boolean;
  /** When true, clicking a host with an already-open tab focuses it instead of opening a new one. */
  focusExistingTab: boolean;
}

export interface HostSidebarPreferences {
  version: number;
  sort: { key: SortKey; pinnedFirst: boolean };
  groupKey: HostGroupKey;
  filters: HostSidebarFilterState;
  openFolders: string[];
  display: HostSidebarDisplayPreferences;
}

const GROUP_KEYS: HostGroupKey[] = [
  "folder",
  "tag",
  "status",
  "protocol",
  "auth",
];
const SORT_KEYS: SortKey[] = [
  "default",
  "name-asc",
  "name-desc",
  "ip-asc",
  "ip-desc",
  "status-online",
  "status-offline",
  "manual",
];
const DENSITIES: HostDensity[] = ["comfortable", "compact"];
const TRAY_TRIGGERS: HostTrayTrigger[] = [
  "always",
  "hover",
  "click",
  "actionsOnly",
];
const STATUS_COLOR_SCHEMES: StatusColorScheme[] = ["accent", "status"];
const FILTER_STATUS: HostSidebarFilterState["status"] = [
  "online",
  "offline",
  "pinned",
];
/** Same shape as a manifest's auth type and protocol ids. */
const AUTH_TYPE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const FILTER_FEATURES: HostSidebarFilterState["features"] = [
  "terminal",
  "fileManager",
  "tunnel",
  "docker",
];

export function defaultHostSidebarPreferences(): HostSidebarPreferences {
  return {
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
      focusExistingTab: true,
    },
  };
}

function sanitizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((v): v is string => typeof v === "string");
}

function sanitizeEnumArray<T extends string>(
  input: unknown,
  allowed: readonly T[],
): T[] {
  if (!Array.isArray(input)) return [];
  return input.filter((v): v is T => allowed.includes(v as T));
}

export function sanitizeHostSidebarPreferences(
  input: unknown,
): HostSidebarPreferences {
  const defaults = defaultHostSidebarPreferences();
  if (!input || typeof input !== "object") return defaults;
  const obj = input as Record<string, unknown>;

  const sortObj = (obj.sort ?? {}) as Record<string, unknown>;
  const sort = {
    key: SORT_KEYS.includes(sortObj.key as SortKey)
      ? (sortObj.key as SortKey)
      : defaults.sort.key,
    pinnedFirst:
      typeof sortObj.pinnedFirst === "boolean"
        ? sortObj.pinnedFirst
        : defaults.sort.pinnedFirst,
  };

  const groupKey = GROUP_KEYS.includes(obj.groupKey as HostGroupKey)
    ? (obj.groupKey as HostGroupKey)
    : defaults.groupKey;

  const filtersObj = (obj.filters ?? {}) as Record<string, unknown>;
  const filters: HostSidebarFilterState = {
    status: sanitizeEnumArray(filtersObj.status, FILTER_STATUS),
    authType: sanitizeStringArray(filtersObj.authType).filter((value) =>
      AUTH_TYPE_PATTERN.test(value),
    ),
    protocol: sanitizeStringArray(filtersObj.protocol).filter((value) =>
      AUTH_TYPE_PATTERN.test(value),
    ),
    features: sanitizeEnumArray(filtersObj.features, FILTER_FEATURES),
    tags: sanitizeStringArray(filtersObj.tags),
  };

  const openFolders = sanitizeStringArray(obj.openFolders);

  const displayObj = (obj.display ?? {}) as Record<string, unknown>;
  const display: HostSidebarDisplayPreferences = {
    density: DENSITIES.includes(displayObj.density as HostDensity)
      ? (displayObj.density as HostDensity)
      : defaults.display.density,
    showTags:
      typeof displayObj.showTags === "boolean"
        ? displayObj.showTags
        : defaults.display.showTags,
    trayTrigger: TRAY_TRIGGERS.includes(
      displayObj.trayTrigger as HostTrayTrigger,
    )
      ? (displayObj.trayTrigger as HostTrayTrigger)
      : defaults.display.trayTrigger,
    statusColorScheme: STATUS_COLOR_SCHEMES.includes(
      displayObj.statusColorScheme as StatusColorScheme,
    )
      ? (displayObj.statusColorScheme as StatusColorScheme)
      : defaults.display.statusColorScheme,
    openOnDoubleClick:
      typeof displayObj.openOnDoubleClick === "boolean"
        ? displayObj.openOnDoubleClick
        : defaults.display.openOnDoubleClick,
    showFolderPaths:
      typeof displayObj.showFolderPaths === "boolean"
        ? displayObj.showFolderPaths
        : defaults.display.showFolderPaths,
    focusExistingTab:
      typeof displayObj.focusExistingTab === "boolean"
        ? displayObj.focusExistingTab
        : defaults.display.focusExistingTab,
  };

  return {
    version: HOST_SIDEBAR_PREFS_VERSION,
    sort,
    groupKey,
    filters,
    openFolders,
    display,
  };
}
