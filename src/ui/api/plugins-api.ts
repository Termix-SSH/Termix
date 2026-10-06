import { rbacApi } from "@/main-axios";

export interface PluginTabContribution {
  id: string;
  titleKey: string;
  icon: string;
  openFrom: string[];
}

export type PluginSettingsFieldType =
  | "boolean"
  | "string"
  | "number"
  | "select"
  | "multiselect"
  | "secret"
  | "textarea"
  | "json"
  | "custom";

export interface PluginSettingsField {
  key: string;
  type: PluginSettingsFieldType;
  labelKey?: string;
  descriptionKey?: string;
  placeholderKey?: string;
  default?: unknown;
  options?: { value: string; labelKey: string }[];
  min?: number;
  max?: number;
  requires?: string;
  permission?: string;
  group?: string;
  component?: string;
  hidden?: boolean;
  defaultable?: boolean;
  defaultLevels?: Array<"admin" | "user" | "folder">;
  personal?: boolean;
  secretKeys?: string[];
  shareRead?: "connect" | "view" | "edit" | "manage";
  ownerOnly?: boolean;
}

export interface PluginHostSettingsContribution {
  enableKey?: string;
  enableLabelKey?: string;
  enableDescriptionKey?: string;
  enableDefault?: boolean;
  editorGroup?: "top" | "ssh";
  editorOrder?: number;
  fields: PluginSettingsField[];
}

/** A plugin's Appearance defaults for each interface preset. */
export type PluginUiPresets = Record<
  "simple" | "balanced" | "advanced",
  Record<string, unknown>
>;

export interface PluginSettingsContribution {
  admin?: PluginSettingsField[];
  user?: PluginSettingsField[];
  host?: PluginHostSettingsContribution;
}

/** A panel or dashboard card, declared so its owner is known while it is off. */
export interface PluginViewContribution {
  id: string;
  titleKey: string;
  icon?: string;
}

export interface PluginContributions {
  tabs?: PluginTabContribution[];
  panels?: PluginViewContribution[];
  dashboardCards?: PluginViewContribution[];
  /** The frontend also runs on anonymous guest pages. */
  guest?: boolean;
  settings?: PluginSettingsContribution;
  permissions?: { name: string; titleKey: string; descriptionKey: string }[];
  uiPresets?: PluginUiPresets;
}

export {
  isRedactedSecret,
  type RedactedSecret,
} from "@termix-ssh/plugin-sdk/settings";

export type PluginSettingsValues = Record<string, unknown>;

/** Per-field messages from a rejected PUT, keyed by field key. */
export interface PluginSettingsErrors {
  [key: string]: string;
}

export class PluginSettingsValidationError extends Error {
  readonly errors: PluginSettingsErrors;

  constructor(errors: PluginSettingsErrors) {
    super("Some settings were rejected");
    this.name = "PluginSettingsValidationError";
    this.errors = errors;
  }
}

function settingsPath(pluginId: string, suffix: string): string {
  return `/plugins/${encodeURIComponent(pluginId)}/settings/${suffix}`;
}

/** Turns a 400 carrying per-field errors into something a form can render. */
async function putSettings(
  path: string,
  values: PluginSettingsValues,
): Promise<PluginSettingsValues> {
  try {
    const response = await rbacApi.put(path, values);
    return response.data?.values ?? {};
  } catch (error) {
    const data = (
      error as { response?: { status?: number; data?: { errors?: unknown } } }
    ).response;
    if (data?.status === 400 && data.data?.errors) {
      throw new PluginSettingsValidationError(
        data.data.errors as PluginSettingsErrors,
      );
    }
    throw error;
  }
}

export async function getPluginAdminSettings(
  pluginId: string,
): Promise<PluginSettingsValues> {
  const response = await rbacApi.get(settingsPath(pluginId, "admin"));
  return response.data?.values ?? {};
}

/** Tells the plugin's own frontend, through app.onSettingsChanged. */
export const PLUGIN_SETTINGS_CHANGED_EVENT = "termix:plugin-settings-changed";

function announceSettingsChange(
  pluginId: string,
  scope: "admin" | "user" | "host",
  hostId?: number,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PLUGIN_SETTINGS_CHANGED_EVENT, {
      detail: { pluginId, scope, hostId },
    }),
  );
}

export async function updatePluginAdminSettings(
  pluginId: string,
  values: PluginSettingsValues,
): Promise<PluginSettingsValues> {
  const saved = await putSettings(settingsPath(pluginId, "admin"), values);
  announceSettingsChange(pluginId, "admin");
  return saved;
}

export async function getPluginUserSettings(
  pluginId: string,
): Promise<PluginSettingsValues> {
  const response = await rbacApi.get(settingsPath(pluginId, "user"));
  return response.data?.values ?? {};
}

export async function updatePluginUserSettings(
  pluginId: string,
  values: PluginSettingsValues,
): Promise<PluginSettingsValues> {
  const saved = await putSettings(settingsPath(pluginId, "user"), values);
  announceSettingsChange(pluginId, "user");
  return saved;
}

export async function getPluginHostSettings(
  pluginId: string,
  hostId: number,
): Promise<PluginSettingsValues> {
  const response = await rbacApi.get(
    settingsPath(pluginId, `host/${encodeURIComponent(String(hostId))}`),
  );
  return response.data?.values ?? {};
}

export async function updatePluginHostSettings(
  pluginId: string,
  hostId: number,
  values: PluginSettingsValues,
): Promise<PluginSettingsValues> {
  const saved = await putSettings(
    settingsPath(pluginId, `host/${encodeURIComponent(String(hostId))}`),
    values,
  );
  announceSettingsChange(pluginId, "host", hostId);
  return saved;
}

/**
 * What GET /plugins returns.
 *
 * The admin-only fields are absent for a caller without
 * admin.plugins.manage: what a plugin may do, what it has been granted and
 * why it failed are operational details the shell does not need.
 */
export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  /** enabled | disabled | blocked | failed, or the loader's live state. */
  state: string;
  contributes: PluginContributions | null;
  /** Lucide icon name from the manifest. */
  icon?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  /** A built frontend bundle is served at /plugin-assets/<id>/frontend.js. */
  frontend?: boolean;
  /** A frontend.css sits beside the bundle. */
  css?: boolean;
  /** Cache key for the bundle; changes when it is rebuilt. */
  assetVersion?: string | null;
  /** "en" plus the xx_YY names of shipped translations. */
  locales?: string[];

  tier?: string;
  source?: string;
  /** Capabilities this plugin's manifest declares. Admins only. */
  capabilities?: string[];
  /** The subset of `capabilities` actually granted. Admins only. */
  grantedCapabilities?: string[];
  /** Why the plugin is blocked or failed. Admins only. */
  lastError?: string | null;
  /** Paths a running plugin serves without login. Admins only. */
  publicRoutes?: { http: string[]; ws: string[] };
  registryId?: string | null;
  autoUpdate?: boolean;
  pinnedVersion?: string | null;
  description?: string;
  author?: string;
  repository?: string;
  signedBy?: string | null;
}

export async function getPlugins(): Promise<PluginSummary[]> {
  const response = await rbacApi.get("/plugins");
  return Array.isArray(response.data) ? response.data : [];
}

/** Fired after any change to installed plugins; the loader resyncs on it. */
export const PLUGINS_CHANGED_EVENT = "termix:plugins-changed";

function announcePluginsChanged(): void {
  window.dispatchEvent(new CustomEvent(PLUGINS_CHANGED_EVENT));
}

export interface RegistryPluginVersion {
  version: string;
  compatible: boolean;
  capabilities: string[];
  publishedAt?: string;
  releaseNotesUrl?: string;
  size: number;
}

export interface RegistryPluginEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
  repository?: string;
  icon?: string;
  versions: RegistryPluginVersion[];
  latestVersion: string | null;
  installed: boolean;
  installedVersion: string | null;
  updateAvailable: boolean;
  addedCapabilities: string[];
  pinnedVersion: string | null;
  autoUpdate: boolean;
  bundled: boolean;
}

export interface RegistryListing {
  registry: {
    id: string;
    url: string;
    lastCheckedAt: string | null;
    error: string | null;
  };
  managedByServer: boolean;
  plugins: RegistryPluginEntry[];
}

export interface PluginStateChange {
  id: string;
  enabled: boolean;
  enable: string[];
  disable: string[];
  missing: string[];
  state?: string;
}

export interface PluginDataSummary {
  id: string;
  tables: Array<{ name: string; rows: number | null }>;
  kvKeys: number;
  settings: { admin: number; user: number; host: number; secret: number };
  migrations: Array<{ id: string; appliedAt: string | null }>;
  grants: Array<{
    capability: string;
    source: string;
    grantedAt: string | null;
  }>;
  filesBytes: number;
}

export interface UpdateAllResult {
  updated: Array<{ id: string; version: string }>;
  needsReview: Array<{ id: string; capabilities: string[] }>;
  failed: Array<{ id: string; error: string }>;
}

const pluginPath = (pluginId: string) =>
  `/plugins/${encodeURIComponent(pluginId)}`;

export async function getPluginRegistry(
  refresh = false,
): Promise<RegistryListing> {
  const response = await rbacApi.get("/plugins/registry", {
    params: refresh ? { refresh: 1 } : undefined,
  });
  return response.data;
}

export async function installPlugin(
  pluginId: string,
  version?: string,
): Promise<{ id: string; version: string; state: string }> {
  try {
    const response = await rbacApi.post(`${pluginPath(pluginId)}/install`, {
      version,
    });
    return response.data;
  } finally {
    announcePluginsChanged();
  }
}

export async function updatePlugin(
  pluginId: string,
  options: { version?: string; acceptCapabilities?: boolean } = {},
): Promise<{ id: string; version: string; state: string }> {
  try {
    const response = await rbacApi.post(
      `${pluginPath(pluginId)}/update`,
      options,
    );
    return response.data;
  } finally {
    announcePluginsChanged();
  }
}

export async function updateAllPlugins(): Promise<UpdateAllResult> {
  try {
    const response = await rbacApi.post("/plugins/update-all");
    return response.data;
  } finally {
    announcePluginsChanged();
  }
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  try {
    await rbacApi.delete(pluginPath(pluginId));
  } finally {
    announcePluginsChanged();
  }
}

export async function previewPluginState(
  pluginId: string,
  enabled: boolean,
): Promise<PluginStateChange> {
  const response = await rbacApi.patch(
    `${pluginPath(pluginId)}/state`,
    { enabled },
    { params: { dryRun: 1 } },
  );
  return response.data;
}

export async function setPluginState(
  pluginId: string,
  enabled: boolean,
): Promise<PluginStateChange> {
  try {
    const response = await rbacApi.patch(`${pluginPath(pluginId)}/state`, {
      enabled,
    });
    return response.data;
  } finally {
    announcePluginsChanged();
  }
}

export async function retryPlugin(pluginId: string): Promise<void> {
  try {
    await rbacApi.post(`${pluginPath(pluginId)}/retry`);
  } finally {
    announcePluginsChanged();
  }
}

export async function setPluginOptions(
  pluginId: string,
  options: { autoUpdate?: boolean; pinned?: boolean },
): Promise<{ autoUpdate: boolean; pinnedVersion: string | null }> {
  const response = await rbacApi.patch(
    `${pluginPath(pluginId)}/options`,
    options,
  );
  return response.data;
}

export async function getPluginData(
  pluginId: string,
): Promise<PluginDataSummary> {
  const response = await rbacApi.get(`${pluginPath(pluginId)}/data`);
  return response.data;
}

export async function deletePluginData(pluginId: string): Promise<void> {
  try {
    await rbacApi.delete(`${pluginPath(pluginId)}/data`);
  } finally {
    announcePluginsChanged();
  }
}
