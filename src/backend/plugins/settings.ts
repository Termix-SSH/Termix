/**
 * Plugin settings: validation, storage, encryption and change notification.
 *
 * One module behind both ctx.settings and the /plugins/:id/settings routes, so
 * "what is a valid value", "which fields are secret" and "what a read hands
 * back" are decided once. Two implementations would drift, and the one that
 * drifted would be the one writing to the database.
 *
 * A field the manifest never declared is rejected rather than stored. That is
 * what stops a PUT from filling a plugin's namespace with arbitrary keys, and
 * it is why every entry point resolves the field first and the value second.
 */

import type {
  PluginManifest,
  PluginSettingsField,
} from "@termix/plugin-sdk/manifest";
import {
  coerceSettingValue,
  isRedactedSecret,
  validateSettingValue,
} from "@termix/plugin-sdk/settings";
import { createCurrentPluginSettingsRepository } from "../database/repositories/factory.js";
import type { PluginSettingsScope } from "../database/repositories/plugin-settings-repository.js";
import {
  decryptSystemSecret,
  encryptSystemSecret,
} from "../utils/system-secret-crypto.js";
import { pluginLogger } from "../utils/logger.js";

export type { PluginSettingsScope };

/**
 * Core settings a plugin may read through ctx.settings.readCore.
 *
 * Deliberately short. Everything here is either already visible in the UI to
 * every user, or a switch a plugin has to honour to behave correctly. Adding
 * to it means deciding that every plugin holding settings:read-core may see
 * that value, so it is a review decision rather than a convenience.
 */
export const CORE_SETTINGS_ALLOWLIST: readonly string[] = [
  "app_name",
  "notification_private_endpoint_allowlist",
];

type ChangeListener = (value: unknown) => void;

/** pluginId -> key -> listeners. In-process only; settings are not clustered. */
const listeners = new Map<string, Map<string, Set<ChangeListener>>>();

export function onSettingsChange(
  pluginId: string,
  key: string,
  listener: ChangeListener,
): () => void {
  let byKey = listeners.get(pluginId);
  if (!byKey) {
    byKey = new Map();
    listeners.set(pluginId, byKey);
  }
  let set = byKey.get(key);
  if (!set) {
    set = new Set();
    byKey.set(key, set);
  }
  set.add(listener);

  return () => {
    set!.delete(listener);
    if (set!.size === 0) byKey!.delete(key);
    if (byKey!.size === 0) listeners.delete(pluginId);
  };
}

function notify(pluginId: string, key: string, value: unknown): void {
  for (const listener of listeners.get(pluginId)?.get(key) ?? []) {
    try {
      listener(value);
    } catch (error) {
      // A listener throwing must not fail the write that already happened.
      pluginLogger.error(
        `Plugin ${pluginId} settings listener for "${key}" failed`,
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_settings_change" },
      );
    }
  }
}

/** Drops every listener a plugin registered. Called when it deactivates. */
export function clearSettingsListeners(pluginId: string): void {
  listeners.delete(pluginId);
}

/** The fields a manifest declares for one scope. */
export function declaredFields(
  manifest: PluginManifest,
  scope: PluginSettingsScope,
): PluginSettingsField[] {
  const settings = manifest.contributes?.settings;
  if (!settings) return [];

  if (scope === "admin") return settings.admin ?? [];
  if (scope === "user") return settings.user ?? [];

  const host = settings.host;
  if (!host) return [];

  // The enable switch is a real stored key, so it has to behave like a field
  // everywhere: validated on write, defaulted on read, rendered in the editor.
  const enableField: PluginSettingsField[] = host.enableKey
    ? [
        {
          key: host.enableKey,
          type: "boolean",
          labelKey: host.enableLabelKey,
          default: false,
        },
      ]
    : [];

  return [...enableField, ...host.fields];
}

export function findField(
  manifest: PluginManifest,
  scope: PluginSettingsScope,
  key: string,
): PluginSettingsField | undefined {
  return declaredFields(manifest, scope).find((field) => field.key === key);
}

function normalizeScopeId(
  scope: PluginSettingsScope,
  scopeId: string | number | undefined | null,
): string | null {
  if (scope === "admin") return null;
  if (scopeId === undefined || scopeId === null) {
    throw new Error(`Plugin settings scope "${scope}" requires a scope id`);
  }
  return String(scopeId);
}

/** Stored values are JSON so a field keeps its declared type on the way back. */
function encode(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function decode(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export async function getSetting(
  manifest: PluginManifest,
  scope: PluginSettingsScope,
  scopeId: string | number | null | undefined,
  key: string,
): Promise<unknown> {
  const field = findField(manifest, scope, key);
  if (!field) return undefined;

  const row = await createCurrentPluginSettingsRepository().get(
    manifest.id,
    scope,
    normalizeScopeId(scope, scopeId),
    key,
  );

  if (!row || row.value === null) return field.default;

  const decoded = decode(row.value);
  if (decoded === undefined || decoded === null) return field.default;

  if (row.encrypted && typeof decoded === "string") {
    return decryptSystemSecret(decoded);
  }
  return decoded;
}

export interface SetSettingOptions {
  /** Skips validation for a value core itself produced, such as a migration. */
  trusted?: boolean;
}

/**
 * Writes one value, after validating it against the declared field.
 *
 * Returns the error message when the value is rejected, or null on success,
 * rather than throwing: a PUT reports every bad field at once and a throw per
 * field would only ever surface the first.
 */
export async function setSetting(
  manifest: PluginManifest,
  scope: PluginSettingsScope,
  scopeId: string | number | null | undefined,
  key: string,
  value: unknown,
  options: SetSettingOptions = {},
): Promise<string | null> {
  const field = findField(manifest, scope, key);
  if (!field) {
    return `"${key}" is not a settings field this plugin declares`;
  }

  // Echoing a redacted secret back means "leave it alone", so a form can save
  // without clearing a key it was never shown.
  if (field.type === "secret" && isRedactedSecret(value)) return null;

  const coerced = options.trusted ? value : coerceSettingValue(field, value);
  if (!options.trusted) {
    const error = validateSettingValue(field, coerced);
    if (error) return error;
  }

  // Clearing a secret writes null rather than an encrypted empty string, so a
  // read reports it as unset instead of "set to nothing".
  const clearingSecret = field.type === "secret" && coerced === "";
  const shouldEncrypt =
    field.type === "secret" && typeof coerced === "string" && !clearingSecret;
  const stored = clearingSecret
    ? null
    : shouldEncrypt
      ? encode(await encryptSystemSecret(coerced as string))
      : encode(coerced);

  await createCurrentPluginSettingsRepository().set(
    manifest.id,
    scope,
    normalizeScopeId(scope, scopeId),
    key,
    stored,
    shouldEncrypt,
  );

  notify(manifest.id, key, coerced);
  return null;
}

export interface GetAllOptions {
  /** Replaces every secret with { set } so the value never leaves the server. */
  redactSecrets?: boolean;
}

/**
 * Every declared field for one scope, with stored values over defaults.
 *
 * Driven by the manifest rather than by the rows, so a field that was never
 * written still comes back with its default and a stale row for a field the
 * plugin has since dropped is ignored instead of being handed to the UI.
 */
export async function getAllSettings(
  manifest: PluginManifest,
  scope: PluginSettingsScope,
  scopeId: string | number | null | undefined,
  options: GetAllOptions = {},
): Promise<Record<string, unknown>> {
  const fields = declaredFields(manifest, scope);
  if (fields.length === 0) return {};

  const rows = await createCurrentPluginSettingsRepository().getAll(
    manifest.id,
    scope,
    normalizeScopeId(scope, scopeId),
  );
  const byKey = new Map(rows.map((row) => [row.key, row]));

  const values: Record<string, unknown> = {};
  for (const field of fields) {
    values[field.key] = await resolveFieldValue(
      field,
      byKey.get(field.key),
      options,
    );
  }
  return values;
}

/** Shared by getAllSettings and the host-list projection. */
export async function resolveFieldValue(
  field: PluginSettingsField,
  row: { value: string | null; encrypted: boolean } | undefined,
  options: GetAllOptions = {},
): Promise<unknown> {
  const decoded = row && row.value !== null ? decode(row.value) : undefined;
  const hasValue = decoded !== undefined && decoded !== null && decoded !== "";

  if (field.type === "secret") {
    if (options.redactSecrets) return { set: hasValue };
    if (!hasValue) return field.default;
    return row!.encrypted && typeof decoded === "string"
      ? decryptSystemSecret(decoded)
      : decoded;
  }

  return hasValue ? decoded : field.default;
}

/**
 * Reads a core server setting. The caller has already checked
 * settings:read-core; this only enforces the allowlist.
 */
export async function readCoreSetting(key: string): Promise<string | null> {
  if (!CORE_SETTINGS_ALLOWLIST.includes(key)) {
    throw new Error(
      `Core setting "${key}" is not readable by plugins. Readable keys: ${CORE_SETTINGS_ALLOWLIST.join(", ")}`,
    );
  }

  const { createCurrentSettingsRepository } =
    await import("../database/repositories/factory.js");
  return createCurrentSettingsRepository().get(key);
}
