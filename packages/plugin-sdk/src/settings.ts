/**
 * Settings field validation, shared by core and the frontend.
 *
 * Both the HTTP routes and the form renderer call these, so "what counts as a
 * valid value" is decided once. A field the manifest never declared has no
 * entry here and is rejected rather than stored, which is what stops a PUT
 * from writing arbitrary keys into a plugin's namespace.
 */

import type { PluginSettingsField } from "./manifest.js";

/** The permission an admin-scope field requires when it names none itself. */
export const ADMIN_SETTINGS_PERMISSION = "admin.plugins.manage";

/** What a secret looks like on the wire. The value never leaves the server. */
export interface RedactedSecret {
  set: boolean;
}

export function isRedactedSecret(value: unknown): value is RedactedSecret {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as RedactedSecret).set === "boolean"
  );
}

/**
 * Turns whatever arrived on the wire into the type the field declares.
 *
 * Forms send everything as strings, so a number field that refused "30" would
 * reject every value the UI can produce. Anything genuinely unconvertible is
 * left alone for validateSettingValue to reject with a readable message.
 */
export function coerceSettingValue(
  field: PluginSettingsField,
  value: unknown,
): unknown {
  if (value === null || value === undefined) return value;

  switch (field.type) {
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      return value;

    case "number": {
      if (typeof value === "number") return value;
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? value : parsed;
      }
      return value;
    }

    case "multiselect":
      return Array.isArray(value) ? value : value === "" ? [] : value;

    case "string":
    case "secret":
    case "textarea":
    case "select":
      return typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : value;

    default:
      return value;
  }
}

/**
 * Returns an error message, or null when the value is acceptable.
 *
 * Messages are plain English rather than i18n keys: they name the offending
 * field and the rule it broke, and the UI shows them beside the input.
 */
export function validateSettingValue(
  field: PluginSettingsField,
  value: unknown,
): string | null {
  // Clearing a field is always allowed; the default takes over on read.
  if (value === null || value === undefined) return null;

  switch (field.type) {
    case "boolean":
      return typeof value === "boolean"
        ? null
        : `"${field.key}" must be true or false`;

    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `"${field.key}" must be a number`;
      }
      if (field.min !== undefined && value < field.min) {
        return `"${field.key}" must be at least ${field.min}`;
      }
      if (field.max !== undefined && value > field.max) {
        return `"${field.key}" must be at most ${field.max}`;
      }
      return null;
    }

    case "select": {
      if (typeof value !== "string") {
        return `"${field.key}" must be a string`;
      }
      const allowed = (field.options ?? []).map((option) => option.value);
      return allowed.includes(value)
        ? null
        : `"${field.key}" must be one of: ${allowed.join(", ")}`;
    }

    case "multiselect": {
      if (!Array.isArray(value)) {
        return `"${field.key}" must be an array`;
      }
      const allowed = (field.options ?? []).map((option) => option.value);
      for (const entry of value) {
        if (typeof entry !== "string" || !allowed.includes(entry)) {
          return `"${field.key}" may only contain: ${allowed.join(", ")}`;
        }
      }
      return null;
    }

    case "json": {
      if (typeof value === "string") {
        try {
          JSON.parse(value);
          return null;
        } catch {
          return `"${field.key}" must be valid JSON`;
        }
      }
      // Already-parsed JSON is fine as long as it survives a round trip.
      try {
        JSON.stringify(value);
        return null;
      } catch {
        return `"${field.key}" must be valid JSON`;
      }
    }

    case "secret":
      // A redacted echo is a no-op rather than a value, handled by the caller.
      if (isRedactedSecret(value)) return null;
      return typeof value === "string"
        ? null
        : `"${field.key}" must be a string`;

    case "string":
    case "textarea":
      return typeof value === "string"
        ? null
        : `"${field.key}" must be a string`;

    case "custom":
      // The component owns its own shape; core only stores what it sends.
      return null;

    default:
      return `"${field.key}" has an unknown type`;
  }
}

/** The declared defaults for a scope, used when no row has been written. */
export function defaultsFor(
  fields: readonly PluginSettingsField[] = [],
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.default !== undefined) defaults[field.key] = field.default;
  }
  return defaults;
}

/** Looks a field up by key, for a caller holding only the declared list. */
export function findSettingsField(
  fields: readonly PluginSettingsField[] = [],
  key: string,
): PluginSettingsField | undefined {
  return fields.find((field) => field.key === key);
}

/**
 * Whether a field should be shown or accepted, given the rest of the scope.
 *
 * A field declaring `requires` is inert while its named boolean is off, so the
 * UI hides it and a write to it is pointless rather than wrong.
 */
export function isFieldActive(
  field: PluginSettingsField,
  values: Record<string, unknown>,
): boolean {
  if (!field.requires) return true;
  return values[field.requires] === true;
}

export type { PluginSettingsField } from "./manifest.js";
