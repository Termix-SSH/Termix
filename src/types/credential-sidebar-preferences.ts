/**
 * Credential sidebar preferences model. Shared by the frontend sidebar and
 * the backend preferences endpoint (no framework imports, mirrors
 * ./host-sidebar-preferences.ts's dependency-free convention). Independent
 * from HostSidebarPreferences by design, a separate parallel system, not a
 * shared blob, matching how credentialSortKey/credentialFilterState were
 * already independently namespaced from hostSortKey/etc. before this port.
 *
 * Deliberately smaller than HostSidebarPreferences: no groupKey selector
 * (folder is the only grouping credentials have, so there's nothing to
 * pick), no statusColorScheme (credentials have no online/offline concept).
 */

export const CREDENTIAL_SIDEBAR_PREFS_VERSION = 1;

export type CredentialSortKey =
  | "default"
  | "name-asc"
  | "name-desc"
  | "username-asc"
  | "username-desc"
  | "manual";

export type CredentialDensity = "comfortable" | "compact";

export type CredentialTrayTrigger =
  "always" | "hover" | "click" | "actionsOnly";

export interface CredentialSidebarFilterState {
  /** Credential type ids; plugins can add their own. */
  type: string[];
  tags: string[];
}

/** Which parts of a credential row are shown. */
export interface CredentialRowFields {
  showUsername: boolean;
  /** The "3h" count of hosts using it. */
  showUsageCount: boolean;
  showTypeBadge: boolean;
  showPinIcon: boolean;
  showSharedBadge: boolean;
}

export const CREDENTIAL_ROW_FIELD_KEYS: (keyof CredentialRowFields)[] = [
  "showUsername",
  "showUsageCount",
  "showTypeBadge",
  "showPinIcon",
  "showSharedBadge",
];

export function defaultCredentialRowFields(): CredentialRowFields {
  return {
    showUsername: true,
    showUsageCount: true,
    showTypeBadge: true,
    showPinIcon: true,
    showSharedBadge: true,
  };
}

export interface CredentialSidebarDisplayPreferences extends CredentialRowFields {
  density: CredentialDensity;
  showTags: boolean;
  trayTrigger: CredentialTrayTrigger;
}

export interface CredentialSidebarPreferences {
  version: number;
  sort: { key: CredentialSortKey; pinnedFirst: boolean };
  filters: CredentialSidebarFilterState;
  openFolders: string[];
  display: CredentialSidebarDisplayPreferences;
}

const SORT_KEYS: CredentialSortKey[] = [
  "default",
  "name-asc",
  "name-desc",
  "username-asc",
  "username-desc",
  "manual",
];
const DENSITIES: CredentialDensity[] = ["comfortable", "compact"];
const TRAY_TRIGGERS: CredentialTrayTrigger[] = [
  "always",
  "hover",
  "click",
  "actionsOnly",
];
const TYPE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export function defaultCredentialSidebarPreferences(): CredentialSidebarPreferences {
  return {
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
      ...defaultCredentialRowFields(),
    },
  };
}

function sanitizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((v): v is string => typeof v === "string");
}

export function sanitizeCredentialSidebarPreferences(
  input: unknown,
): CredentialSidebarPreferences {
  const defaults = defaultCredentialSidebarPreferences();
  if (!input || typeof input !== "object") return defaults;
  const obj = input as Record<string, unknown>;

  const sortObj = (obj.sort ?? {}) as Record<string, unknown>;
  const sort = {
    key: SORT_KEYS.includes(sortObj.key as CredentialSortKey)
      ? (sortObj.key as CredentialSortKey)
      : defaults.sort.key,
    pinnedFirst:
      typeof sortObj.pinnedFirst === "boolean"
        ? sortObj.pinnedFirst
        : defaults.sort.pinnedFirst,
  };

  const filtersObj = (obj.filters ?? {}) as Record<string, unknown>;
  const filters: CredentialSidebarFilterState = {
    type: sanitizeStringArray(filtersObj.type).filter((value) =>
      TYPE_PATTERN.test(value),
    ),
    tags: sanitizeStringArray(filtersObj.tags),
  };

  const openFolders = sanitizeStringArray(obj.openFolders);

  const displayObj = (obj.display ?? {}) as Record<string, unknown>;
  const rowFields = {} as CredentialRowFields;
  for (const key of CREDENTIAL_ROW_FIELD_KEYS) {
    rowFields[key] =
      typeof displayObj[key] === "boolean"
        ? (displayObj[key] as boolean)
        : defaults.display[key];
  }
  const display: CredentialSidebarDisplayPreferences = {
    ...rowFields,
    density: DENSITIES.includes(displayObj.density as CredentialDensity)
      ? (displayObj.density as CredentialDensity)
      : defaults.display.density,
    showTags:
      typeof displayObj.showTags === "boolean"
        ? displayObj.showTags
        : defaults.display.showTags,
    trayTrigger: TRAY_TRIGGERS.includes(
      displayObj.trayTrigger as CredentialTrayTrigger,
    )
      ? (displayObj.trayTrigger as CredentialTrayTrigger)
      : defaults.display.trayTrigger,
  };

  return {
    version: CREDENTIAL_SIDEBAR_PREFS_VERSION,
    sort,
    filters,
    openFolders,
    display,
  };
}
