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
}

export interface PluginHostSettingsContribution {
  enableKey?: string;
  enableLabelKey?: string;
  fields: PluginSettingsField[];
}

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
}

/** A secret as it arrives from the server. The value never leaves the server. */
export interface RedactedSecret {
  set: boolean;
}

export function isRedactedSecret(value: unknown): value is RedactedSecret {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as RedactedSecret).set === "boolean"
  );
}

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

export async function updatePluginAdminSettings(
  pluginId: string,
  values: PluginSettingsValues,
): Promise<PluginSettingsValues> {
  return putSettings(settingsPath(pluginId, "admin"), values);
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
  return putSettings(settingsPath(pluginId, "user"), values);
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
  return putSettings(
    settingsPath(pluginId, `host/${encodeURIComponent(String(hostId))}`),
    values,
  );
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
}

export async function getPlugins(): Promise<PluginSummary[]> {
  const response = await rbacApi.get("/plugins");
  return Array.isArray(response.data) ? response.data : [];
}

export async function setPluginEnabled(
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  await rbacApi.patch(`/plugins/${encodeURIComponent(pluginId)}/state`, {
    enabled,
  });
}

export async function grantPluginCapability(
  pluginId: string,
  capability: string,
): Promise<void> {
  await rbacApi.post(`/plugins/${encodeURIComponent(pluginId)}/grants`, {
    capability,
  });
}

export async function revokePluginCapability(
  pluginId: string,
  capability: string,
): Promise<void> {
  await rbacApi.delete(
    `/plugins/${encodeURIComponent(pluginId)}/grants/${encodeURIComponent(capability)}`,
  );
}
