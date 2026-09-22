/**
 * Manifest v2: the inert JSON description of a plugin.
 *
 * Core reads this without running any plugin code, so everything that decides
 * whether a plugin may load, what it may do and where its UI appears has to be
 * expressible here.
 *
 * Unknown fields are rejected at every level. A typo'd "contribute" or
 * "permissionGroups" used to validate clean and be silently dropped, which
 * made a manifest look like it declared something it did not.
 */

import semver from "semver";
import { isKnownCapability } from "./capabilities.js";

/**
 * The SDK major version this build implements. engine.api is the real
 * compatibility gate; engine.termix is a display string and is never enforced.
 */
export const SUPPORTED_PLUGIN_API_VERSION = "1";

export const PLUGIN_CATEGORIES = [
  "Terminal",
  "Files & Transfer",
  "Infrastructure",
  "Monitoring",
  "Networking",
  "Access & Security",
  "Productivity",
] as const;

export const PLUGIN_PLATFORMS = ["linux", "win32", "darwin"] as const;

export const ACTION_CONTRIBUTION_KINDS = ["button"] as const;
export type ActionContributionKind = (typeof ACTION_CONTRIBUTION_KINDS)[number];

const OPEN_FROM_VALUES = ["rail", "host-context-menu", "palette"] as const;

const ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?(\+[0-9A-Za-z-.]+)?$/;
const API_VERSION_PATTERN = /^[0-9]+$/;
/** Service names are dotted, e.g. "ssh.transport". */
const SERVICE_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const SECRET_KEY_PATTERN = /^[a-z0-9-]+$/;
/** Action ids name a frontend function, so segments may be camelCase. */
const ACTION_ID_PATTERN = /^[a-z0-9-]+(\.[a-zA-Z0-9-]+)+$/;
const HANDLER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const PERMISSION_PATTERN = /^[a-z0-9-]+(\.[a-z0-9_-]+)+$/;
/**
 * A plugin-relative permission name. Unlike a full id one segment is fine,
 * and underscores are allowed in the first segment too ("manage_providers").
 */
const PERMISSION_NAME_PATTERN = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;

/** The roles core seeds. A plugin may only set defaults for these. */
export const SYSTEM_ROLE_NAMES = ["admin", "user"] as const;
export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number];

/**
 * Core permission groups. A plugin permission may not start with one of these,
 * or a manifest could declare admin.users.manage and gate a route on it.
 */
export const RESERVED_PERMISSION_PREFIXES = [
  "hosts",
  "snippets",
  "credentials",
  "admin",
] as const;

/** The id a plugin-relative permission name is registered under. */
export function qualifyPermission(pluginId: string, name: string): string {
  return `${pluginId}.${name}`;
}

export interface PluginAuthor {
  name: string;
  url?: string;
}

export interface PluginEngine {
  /** Display string only, e.g. ">=2.9.0". Never enforced. */
  termix: string;
  /** SDK major version as a string. The real gate. */
  api: string;
}

export interface HostCapabilityContribution {
  key: string;
  labelKey: string;
  editorTab: string;
}

export interface PluginTabContribution {
  id: string;
  titleKey: string;
  icon: string;
  openFrom: string[];
}

/**
 * One role permission a plugin contributes.
 *
 * `name` is short and plugin-relative; core registers it as
 * `<pluginId>.<name>`, so a plugin can never name a core group or another
 * plugin's namespace. The i18n keys are plugin-relative too.
 */
export interface PluginPermissionContribution {
  name: string;
  titleKey: string;
  descriptionKey: string;
  /** System roles that should hold this the first time it is seen. */
  defaultRoles?: SystemRoleName[];
}

export interface PluginActionContribution {
  id: string;
  titleKey: string;
  /** Name of the frontend export implementing this action. */
  handler: string;
  icon?: string;
  permission?: string;
  slot?: string;
  kind?: ActionContributionKind;
}

export interface PluginActionSlot {
  id: string;
  accepts: ActionContributionKind[];
  descriptionKey?: string;
}

export interface PluginServiceProvide {
  service: string;
  version: string;
  /** The role permission a calling user needs. */
  permission: string;
}

export interface PluginServiceRequire {
  service: string;
  versionRange: string;
  optional?: boolean;
}

export interface PluginSecretProvide {
  key: string;
  permission: string;
  descriptionKey?: string;
}

export interface PluginSecretRequire {
  plugin: string;
  key: string;
  optional?: boolean;
}

export const SETTINGS_FIELD_TYPES = [
  "boolean",
  "string",
  "number",
  "select",
  "multiselect",
  "secret",
  "textarea",
  "json",
  "custom",
] as const;
export type PluginSettingsFieldType = (typeof SETTINGS_FIELD_TYPES)[number];

export const SETTINGS_SCOPES = ["admin", "user", "host"] as const;
export type PluginSettingsScope = (typeof SETTINGS_SCOPES)[number];

export interface PluginSettingsOption {
  value: string;
  labelKey: string;
}

/**
 * One field on a plugin's settings page.
 *
 * Core renders these; a plugin supplies data only, so it cannot ship its own
 * form styling and drift from the rest of the app. `type: "custom"` is the
 * escape hatch for UI a schema cannot express, and names a component the
 * frontend registered rather than carrying markup.
 */
export interface PluginSettingsField {
  key: string;
  type: PluginSettingsFieldType;
  /** Required except for "custom", which draws its own label. */
  labelKey?: string;
  descriptionKey?: string;
  placeholderKey?: string;
  default?: unknown;
  /** select and multiselect only. */
  options?: PluginSettingsOption[];
  /** number only. */
  min?: number;
  max?: number;
  /** Key of a boolean field in the same scope that must be on. */
  requires?: string;
  /**
   * Who may write it. Admin fields default to admin.plugins.manage; a short
   * name resolves against this plugin's own permissions.
   */
  permission?: string;
  /** Section heading this field sits under. */
  group?: string;
  /** Registered component id. Required when type is "custom". */
  component?: string;
}

export interface PluginHostSettingsContribution {
  /** Boolean field rendered first, gating the rest of the section. */
  enableKey?: string;
  enableLabelKey?: string;
  fields: PluginSettingsField[];
}

export interface PluginSettingsContribution {
  admin?: PluginSettingsField[];
  user?: PluginSettingsField[];
  host?: PluginHostSettingsContribution;
}

export interface PluginContributions {
  tabs?: PluginTabContribution[];
  actions?: PluginActionContribution[];
  actionSlots?: PluginActionSlot[];
  permissions?: PluginPermissionContribution[];
  settings?: PluginSettingsContribution;
  /**
   * A host-editor checkbox backed by a boolean column on the host record.
   * A5/A6/A7 reshape this; it stays in v2 because remote-desktop, docker,
   * proxmox and web-endpoint ship it today.
   */
  hostCapability?: HostCapabilityContribution | HostCapabilityContribution[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: PluginAuthor;
  license: string;
  repository?: string;
  category: string;
  icon?: string;
  engine: PluginEngine;
  /** Catalog capability ids. */
  capabilities: string[];
  /** pluginId -> semver range. A missing one blocks activation. */
  dependencies?: Record<string, string>;
  /** pluginId -> semver range. A missing one is normal. */
  optionalDependencies?: Record<string, string>;
  provides?: PluginServiceProvide[];
  requires?: PluginServiceRequire[];
  providesSecret?: PluginSecretProvide[];
  requiresSecret?: PluginSecretRequire[];
  contributes?: PluginContributions;
  /** Built backend entry, relative to the plugin root. */
  backend?: string;
  /** Built frontend entry, relative to the plugin root. */
  frontend?: string;
  /** Locales directory, relative to the plugin root. */
  locales?: string;
  platforms?: string[];
}

export const DEFAULT_BACKEND_ENTRY = "dist/backend.js";
export const DEFAULT_FRONTEND_ENTRY = "dist/frontend.js";
export const DEFAULT_LOCALES_DIR = "locales";

const REQUIRED_TOP_LEVEL = [
  "id",
  "name",
  "version",
  "description",
  "author",
  "license",
  "engine",
  "category",
  "capabilities",
];

const ALLOWED_TOP_LEVEL = new Set([
  ...REQUIRED_TOP_LEVEL,
  "repository",
  "icon",
  "dependencies",
  "optionalDependencies",
  "provides",
  "requires",
  "providesSecret",
  "requiresSecret",
  "contributes",
  "backend",
  "frontend",
  "locales",
  "platforms",
]);

const ALLOWED_CONTRIBUTES = new Set([
  "tabs",
  "actions",
  "actionSlots",
  "permissions",
  "settings",
  "hostCapability",
]);

const ALLOWED_SETTINGS_FIELD = [
  "key",
  "type",
  "labelKey",
  "descriptionKey",
  "placeholderKey",
  "default",
  "options",
  "min",
  "max",
  "requires",
  "permission",
  "group",
  "component",
];

/** Settings keys are stored as-is, so they stay short and index-safe. */
const SETTINGS_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pushes an error for every key that is not in `allowed`. */
function rejectUnknown(
  value: Record<string, unknown>,
  allowed: Set<string> | string[],
  where: string,
  errors: string[],
): void {
  const set = Array.isArray(allowed) ? new Set(allowed) : allowed;
  for (const key of Object.keys(value)) {
    if (!set.has(key)) {
      errors.push(`Unknown field "${key}" in ${where}`);
    }
  }
}

function requireString(
  value: unknown,
  where: string,
  errors: string[],
): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`Field "${where}" must be a non-empty string`);
    return false;
  }
  return true;
}

export function validateManifest(manifest: unknown): string[] {
  const errors: string[] = [];

  if (!isPlainObject(manifest)) {
    return ["Manifest must be a JSON object"];
  }

  const m = manifest;
  rejectUnknown(m, ALLOWED_TOP_LEVEL, "the manifest", errors);

  for (const field of REQUIRED_TOP_LEVEL) {
    if (!(field in m)) errors.push(`Missing required field: "${field}"`);
  }

  if ("id" in m) {
    if (typeof m.id !== "string" || !ID_PATTERN.test(m.id)) {
      errors.push(
        `Field "id" must match ${ID_PATTERN} (lowercase, starts with a letter, 2-40 chars), got: ${JSON.stringify(m.id)}`,
      );
    }
  }

  if ("name" in m) requireString(m.name, "name", errors);
  if ("description" in m) requireString(m.description, "description", errors);
  if ("license" in m) requireString(m.license, "license", errors);

  if ("version" in m) {
    if (typeof m.version !== "string" || !SEMVER_PATTERN.test(m.version)) {
      errors.push(
        `Field "version" must be valid semver, got: ${JSON.stringify(m.version)}`,
      );
    }
  }

  if ("repository" in m) requireString(m.repository, "repository", errors);
  if ("icon" in m) requireString(m.icon, "icon", errors);
  if ("backend" in m) requireString(m.backend, "backend", errors);
  if ("frontend" in m) requireString(m.frontend, "frontend", errors);
  if ("locales" in m) requireString(m.locales, "locales", errors);

  validateAuthor(m.author, errors);
  validateEngine(m.engine, errors);
  validateCategory(m.category, errors);
  validateCapabilities(m.capabilities, errors);
  validatePlatforms(m.platforms, errors);
  validateDependencyMap(m.dependencies, "dependencies", errors);
  validateDependencyMap(m.optionalDependencies, "optionalDependencies", errors);
  validateProvides(m.provides, errors);
  validateRequires(m.requires, errors);
  validateProvidesSecret(m.providesSecret, errors);
  validateRequiresSecret(m.requiresSecret, errors);
  validateContributes(
    m.contributes,
    typeof m.id === "string" ? m.id : undefined,
    errors,
  );

  return errors;
}

function validateAuthor(author: unknown, errors: string[]): void {
  if (author === undefined) return;
  if (!isPlainObject(author)) {
    errors.push('Field "author" must be an object');
    return;
  }
  rejectUnknown(author, ["name", "url"], '"author"', errors);
  requireString(author.name, "author.name", errors);
  if ("url" in author) requireString(author.url, "author.url", errors);
}

function validateEngine(engine: unknown, errors: string[]): void {
  if (engine === undefined) return;
  if (!isPlainObject(engine)) {
    errors.push('Field "engine" must be an object');
    return;
  }
  rejectUnknown(engine, ["termix", "api"], '"engine"', errors);
  requireString(engine.termix, "engine.termix", errors);
  if (typeof engine.api !== "string" || !API_VERSION_PATTERN.test(engine.api)) {
    errors.push(
      `Field "engine.api" must be an integer string, got: ${JSON.stringify(engine.api)}`,
    );
  }
}

function validateCategory(category: unknown, errors: string[]): void {
  if (category === undefined) return;
  if (typeof category !== "string") {
    errors.push('Field "category" must be a string');
    return;
  }
  if (!PLUGIN_CATEGORIES.includes(category as never)) {
    errors.push(
      `Field "category" must be one of: ${PLUGIN_CATEGORIES.join(", ")}, got: "${category}"`,
    );
  }
}

function validateCapabilities(capabilities: unknown, errors: string[]): void {
  if (capabilities === undefined) return;
  if (!Array.isArray(capabilities)) {
    errors.push('Field "capabilities" must be an array of capability ids');
    return;
  }
  const seen = new Set<string>();
  capabilities.forEach((capability, index) => {
    if (typeof capability !== "string") {
      errors.push(`capabilities[${index}] must be a string`);
      return;
    }
    if (!isKnownCapability(capability)) {
      errors.push(
        `capabilities[${index}] is not a known capability: "${capability}"`,
      );
      return;
    }
    if (seen.has(capability)) {
      errors.push(`capabilities[${index}] duplicates "${capability}"`);
    }
    seen.add(capability);
  });
}

function validatePlatforms(platforms: unknown, errors: string[]): void {
  if (platforms === undefined) return;
  if (!Array.isArray(platforms) || platforms.length === 0) {
    errors.push('Field "platforms" must be a non-empty array when present');
    return;
  }
  platforms.forEach((platform, index) => {
    if (!PLUGIN_PLATFORMS.includes(platform as never)) {
      errors.push(
        `platforms[${index}] must be one of: ${PLUGIN_PLATFORMS.join(", ")}, got: ${JSON.stringify(platform)}`,
      );
    }
  });
}

function validateDependencyMap(
  value: unknown,
  field: string,
  errors: string[],
): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(
      `Field "${field}" must be an object of pluginId -> semver range`,
    );
    return;
  }
  for (const [pluginId, range] of Object.entries(value)) {
    if (!ID_PATTERN.test(pluginId)) {
      errors.push(`${field} key "${pluginId}" is not a valid plugin id`);
    }
    if (typeof range !== "string" || !semver.validRange(range)) {
      errors.push(
        `${field}["${pluginId}"] must be a valid semver range, got: ${JSON.stringify(range)}`,
      );
    }
  }
}

function validateProvides(provides: unknown, errors: string[]): void {
  if (provides === undefined) return;
  if (!Array.isArray(provides)) {
    errors.push('Field "provides" must be an array');
    return;
  }
  const seen = new Set<string>();
  provides.forEach((raw, index) => {
    const where = `provides[${index}]`;
    if (!isPlainObject(raw)) {
      errors.push(`${where} must be an object`);
      return;
    }
    rejectUnknown(raw, ["service", "version", "permission"], where, errors);

    if (typeof raw.service !== "string" || !SERVICE_PATTERN.test(raw.service)) {
      errors.push(`${where}.service must be a dotted lowercase name`);
    } else {
      if (seen.has(raw.service)) {
        errors.push(`${where}.service duplicates "${raw.service}"`);
      }
      seen.add(raw.service);
    }

    if (typeof raw.version !== "string" || !SEMVER_PATTERN.test(raw.version)) {
      errors.push(`${where}.version must be valid semver`);
    }
    requireString(raw.permission, `${where}.permission`, errors);
  });
}

function validateRequires(requires: unknown, errors: string[]): void {
  if (requires === undefined) return;
  if (!Array.isArray(requires)) {
    errors.push('Field "requires" must be an array');
    return;
  }
  requires.forEach((raw, index) => {
    const where = `requires[${index}]`;
    if (!isPlainObject(raw)) {
      errors.push(`${where} must be an object`);
      return;
    }
    rejectUnknown(raw, ["service", "versionRange", "optional"], where, errors);

    if (typeof raw.service !== "string" || !SERVICE_PATTERN.test(raw.service)) {
      errors.push(`${where}.service must be a dotted lowercase name`);
    }
    if (
      typeof raw.versionRange !== "string" ||
      !semver.validRange(raw.versionRange)
    ) {
      errors.push(`${where}.versionRange must be a valid semver range`);
    }
    if ("optional" in raw && typeof raw.optional !== "boolean") {
      errors.push(`${where}.optional must be a boolean`);
    }
  });
}

function validateProvidesSecret(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('Field "providesSecret" must be an array');
    return;
  }
  const seen = new Set<string>();
  value.forEach((raw, index) => {
    const where = `providesSecret[${index}]`;
    if (!isPlainObject(raw)) {
      errors.push(`${where} must be an object`);
      return;
    }
    rejectUnknown(raw, ["key", "permission", "descriptionKey"], where, errors);

    if (typeof raw.key !== "string" || !SECRET_KEY_PATTERN.test(raw.key)) {
      errors.push(`${where}.key must be a lowercase slug`);
    } else {
      if (seen.has(raw.key))
        errors.push(`${where}.key duplicates "${raw.key}"`);
      seen.add(raw.key);
    }
    requireString(raw.permission, `${where}.permission`, errors);
    if ("descriptionKey" in raw) {
      requireString(raw.descriptionKey, `${where}.descriptionKey`, errors);
    }
  });
}

function validateRequiresSecret(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('Field "requiresSecret" must be an array');
    return;
  }
  value.forEach((raw, index) => {
    const where = `requiresSecret[${index}]`;
    if (!isPlainObject(raw)) {
      errors.push(`${where} must be an object`);
      return;
    }
    rejectUnknown(raw, ["plugin", "key", "optional"], where, errors);

    if (typeof raw.plugin !== "string" || !ID_PATTERN.test(raw.plugin)) {
      errors.push(`${where}.plugin must be a valid plugin id`);
    }
    if (typeof raw.key !== "string" || !SECRET_KEY_PATTERN.test(raw.key)) {
      errors.push(`${where}.key must be a lowercase slug`);
    }
    if ("optional" in raw && typeof raw.optional !== "boolean") {
      errors.push(`${where}.optional must be a boolean`);
    }
  });
}

function validateContributes(
  contributes: unknown,
  pluginId: string | undefined,
  errors: string[],
): void {
  if (contributes === undefined) return;
  if (!isPlainObject(contributes)) {
    errors.push('Field "contributes" must be an object');
    return;
  }
  rejectUnknown(contributes, ALLOWED_CONTRIBUTES, '"contributes"', errors);

  validateTabs(contributes.tabs, errors);
  validatePermissions(contributes.permissions, pluginId, errors);
  validateActions(contributes.actions, errors);
  validateActionSlots(contributes.actionSlots, errors);
  validateSettings(contributes.settings, errors);
  validateHostCapability(contributes.hostCapability, errors);
}

function validateSettings(settings: unknown, errors: string[]): void {
  if (settings === undefined) return;
  const where = "contributes.settings";
  if (!isPlainObject(settings)) {
    errors.push(`${where} must be an object`);
    return;
  }
  rejectUnknown(settings, ["admin", "user", "host"], `"${where}"`, errors);

  for (const scope of ["admin", "user"] as const) {
    const value = settings[scope];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      errors.push(`${where}.${scope} must be an array of fields`);
      continue;
    }
    validateSettingsFields(value, `${where}.${scope}`, errors);
  }

  if (settings.host !== undefined) {
    const host = settings.host;
    const at = `${where}.host`;
    if (!isPlainObject(host)) {
      errors.push(`${at} must be an object`);
      return;
    }
    rejectUnknown(
      host,
      ["enableKey", "enableLabelKey", "fields"],
      `"${at}"`,
      errors,
    );

    if ("enableKey" in host) {
      if (
        typeof host.enableKey !== "string" ||
        !SETTINGS_KEY_PATTERN.test(host.enableKey)
      ) {
        errors.push(`${at}.enableKey must be a short alphanumeric key`);
      }
      // An enable switch with no label is a blank row in the host editor.
      requireString(host.enableLabelKey, `${at}.enableLabelKey`, errors);
    }

    if (!Array.isArray(host.fields)) {
      errors.push(`${at}.fields must be an array`);
      return;
    }
    validateSettingsFields(
      host.fields,
      `${at}.fields`,
      errors,
      typeof host.enableKey === "string" ? host.enableKey : undefined,
    );
  }
}

/**
 * Validates one scope's fields.
 *
 * `requires` is checked against the keys declared in the same scope, plus the
 * host scope's enableKey, because a field pointing at a key that does not
 * exist would simply never render.
 */
function validateSettingsFields(
  fields: unknown[],
  where: string,
  errors: string[],
  enableKey?: string,
): void {
  const seen = new Set<string>();
  const booleanKeys = new Set<string>();
  if (enableKey) booleanKeys.add(enableKey);

  fields.forEach((raw, index) => {
    const at = `${where}[${index}]`;
    if (!isPlainObject(raw)) {
      errors.push(`${at} must be an object`);
      return;
    }
    rejectUnknown(raw, ALLOWED_SETTINGS_FIELD, at, errors);

    if (typeof raw.key !== "string" || !SETTINGS_KEY_PATTERN.test(raw.key)) {
      errors.push(`${at}.key must be a short alphanumeric key`);
    } else {
      if (seen.has(raw.key)) {
        errors.push(`${at}.key duplicates "${raw.key}"`);
      }
      seen.add(raw.key);
      if (raw.type === "boolean") booleanKeys.add(raw.key);
      if (enableKey && raw.key === enableKey) {
        errors.push(
          `${at}.key "${raw.key}" is already the section's enableKey`,
        );
      }
    }

    if (
      typeof raw.type !== "string" ||
      !(SETTINGS_FIELD_TYPES as readonly string[]).includes(raw.type)
    ) {
      errors.push(
        `${at}.type must be one of: ${SETTINGS_FIELD_TYPES.join(", ")}`,
      );
      return;
    }

    // A custom field draws its own label, so it needs a component instead.
    if (raw.type === "custom") {
      requireString(raw.component, `${at}.component`, errors);
    } else {
      requireString(raw.labelKey, `${at}.labelKey`, errors);
      if ("component" in raw) {
        errors.push(`${at}.component is only valid when type is "custom"`);
      }
    }

    for (const key of ["descriptionKey", "placeholderKey", "group"] as const) {
      if (key in raw) requireString(raw[key], `${at}.${key}`, errors);
    }
    if ("permission" in raw) {
      requireString(raw.permission, `${at}.permission`, errors);
    }

    if (raw.type === "select" || raw.type === "multiselect") {
      validateSettingsOptions(raw.options, at, errors);
    } else if ("options" in raw) {
      errors.push(`${at}.options is only valid for select and multiselect`);
    }

    if (raw.type === "number") {
      for (const bound of ["min", "max"] as const) {
        if (bound in raw && typeof raw[bound] !== "number") {
          errors.push(`${at}.${bound} must be a number`);
        }
      }
      if (
        typeof raw.min === "number" &&
        typeof raw.max === "number" &&
        raw.min > raw.max
      ) {
        errors.push(`${at}.min must not be greater than ${at}.max`);
      }
    } else if ("min" in raw || "max" in raw) {
      errors.push(`${at}.min and ${at}.max are only valid for number fields`);
    }
  });

  // Second pass: every key is known by now, so forward references are fine.
  fields.forEach((raw, index) => {
    if (!isPlainObject(raw) || !("requires" in raw)) return;
    const at = `${where}[${index}]`;
    if (typeof raw.requires !== "string") {
      errors.push(`${at}.requires must be a string`);
      return;
    }
    if (!booleanKeys.has(raw.requires)) {
      errors.push(
        `${at}.requires "${raw.requires}" must name a boolean field in the same scope`,
      );
    }
  });
}

function validateSettingsOptions(
  options: unknown,
  where: string,
  errors: string[],
): void {
  if (!Array.isArray(options) || options.length === 0) {
    errors.push(`${where}.options must be a non-empty array`);
    return;
  }
  const seen = new Set<string>();
  options.forEach((raw, index) => {
    const at = `${where}.options[${index}]`;
    if (!isPlainObject(raw)) {
      errors.push(`${at} must be an object`);
      return;
    }
    rejectUnknown(raw, ["value", "labelKey"], at, errors);
    if (requireString(raw.value, `${at}.value`, errors)) {
      if (seen.has(raw.value)) {
        errors.push(`${at}.value duplicates "${raw.value}"`);
      }
      seen.add(raw.value);
    }
    requireString(raw.labelKey, `${at}.labelKey`, errors);
  });
}

function validateTabs(tabs: unknown, errors: string[]): void {
  if (tabs === undefined) return;
  if (!Array.isArray(tabs)) {
    errors.push('Field "contributes.tabs" must be an array');
    return;
  }
  const seen = new Set<string>();
  tabs.forEach((raw, index) => {
    const where = `contributes.tabs[${index}]`;
    if (!isPlainObject(raw)) {
      errors.push(`${where} must be an object`);
      return;
    }
    rejectUnknown(raw, ["id", "titleKey", "icon", "openFrom"], where, errors);

    if (requireString(raw.id, `${where}.id`, errors)) {
      if (seen.has(raw.id)) errors.push(`${where}.id duplicates "${raw.id}"`);
      seen.add(raw.id);
    }
    requireString(raw.titleKey, `${where}.titleKey`, errors);
    requireString(raw.icon, `${where}.icon`, errors);

    if (!Array.isArray(raw.openFrom) || raw.openFrom.length === 0) {
      errors.push(`${where}.openFrom must be a non-empty array`);
      return;
    }
    raw.openFrom.forEach((value: unknown, openIndex: number) => {
      if (!OPEN_FROM_VALUES.includes(value as never)) {
        errors.push(
          `${where}.openFrom[${openIndex}] must be one of: ${OPEN_FROM_VALUES.join(", ")}`,
        );
      }
    });
  });
}

function validatePermissions(
  permissions: unknown,
  pluginId: string | undefined,
  errors: string[],
): void {
  if (permissions === undefined) return;
  const where = "contributes.permissions";
  if (!Array.isArray(permissions)) {
    errors.push(`${where} must be an array`);
    return;
  }

  const seen = new Set<string>();

  permissions.forEach((entry: unknown, index: number) => {
    const at = `${where}[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }
    rejectUnknown(
      entry,
      ["name", "titleKey", "descriptionKey", "defaultRoles"],
      at,
      errors,
    );

    const name = entry.name;
    if (typeof name !== "string" || !PERMISSION_NAME_PATTERN.test(name)) {
      errors.push(`${at}.name must be a lowercase, dotted permission name`);
    } else {
      if (seen.has(name)) {
        errors.push(`${at}.name "${name}" is declared more than once`);
      }
      seen.add(name);

      // Core groups first: a plugin naming one could gate a route on core
      // authority it was never given.
      const head = name.split(".")[0];
      if ((RESERVED_PERMISSION_PREFIXES as readonly string[]).includes(head)) {
        errors.push(
          `${at}.name "${name}" starts with the reserved core group "${head}". Permissions are registered as <pluginId>.<name>, so drop the prefix.`,
        );
      }
      // "ai" declaring "ai.use" would register as ai.ai.use, which is always
      // a mistake rather than an intent.
      if (pluginId && (name === pluginId || head === pluginId)) {
        errors.push(
          `${at}.name "${name}" already starts with this plugin's id. Permissions are registered as <pluginId>.<name>, so drop the prefix.`,
        );
      }
    }

    requireString(entry.titleKey, `${at}.titleKey`, errors);
    requireString(entry.descriptionKey, `${at}.descriptionKey`, errors);

    if (entry.defaultRoles === undefined) return;
    if (!Array.isArray(entry.defaultRoles)) {
      errors.push(`${at}.defaultRoles must be an array`);
      return;
    }
    entry.defaultRoles.forEach((role: unknown, roleIndex: number) => {
      if (
        typeof role !== "string" ||
        !(SYSTEM_ROLE_NAMES as readonly string[]).includes(role)
      ) {
        errors.push(
          `${at}.defaultRoles[${roleIndex}] must be one of: ${SYSTEM_ROLE_NAMES.join(", ")}`,
        );
      }
    });
  });
}

function validateActions(actions: unknown, errors: string[]): void {
  if (actions === undefined) return;
  if (!Array.isArray(actions)) {
    errors.push('Field "contributes.actions" must be an array');
    return;
  }
  const seen = new Set<string>();
  actions.forEach((raw, index) => {
    const where = `contributes.actions[${index}]`;
    if (!isPlainObject(raw)) {
      errors.push(`${where} must be an object`);
      return;
    }
    rejectUnknown(
      raw,
      ["id", "titleKey", "handler", "icon", "permission", "slot", "kind"],
      where,
      errors,
    );

    if (typeof raw.id !== "string" || !ACTION_ID_PATTERN.test(raw.id)) {
      errors.push(`${where}.id must be a dotted action id`);
    } else {
      if (seen.has(raw.id)) errors.push(`${where}.id duplicates "${raw.id}"`);
      seen.add(raw.id);
    }

    requireString(raw.titleKey, `${where}.titleKey`, errors);

    if (typeof raw.handler !== "string" || !HANDLER_PATTERN.test(raw.handler)) {
      errors.push(`${where}.handler must be a JavaScript identifier`);
    }
    if ("icon" in raw) requireString(raw.icon, `${where}.icon`, errors);
    if ("permission" in raw) {
      requireString(raw.permission, `${where}.permission`, errors);
    }
    if ("slot" in raw) requireString(raw.slot, `${where}.slot`, errors);
    if (
      "kind" in raw &&
      !ACTION_CONTRIBUTION_KINDS.includes(raw.kind as never)
    ) {
      errors.push(
        `${where}.kind must be one of: ${ACTION_CONTRIBUTION_KINDS.join(", ")}`,
      );
    }
  });
}

function validateActionSlots(slots: unknown, errors: string[]): void {
  if (slots === undefined) return;
  if (!Array.isArray(slots)) {
    errors.push('Field "contributes.actionSlots" must be an array');
    return;
  }
  const seen = new Set<string>();
  slots.forEach((raw, index) => {
    const where = `contributes.actionSlots[${index}]`;
    if (!isPlainObject(raw)) {
      errors.push(`${where} must be an object`);
      return;
    }
    rejectUnknown(raw, ["id", "accepts", "descriptionKey"], where, errors);

    if (typeof raw.id !== "string" || !ACTION_ID_PATTERN.test(raw.id)) {
      errors.push(`${where}.id must be a dotted slot id`);
    } else {
      if (seen.has(raw.id)) errors.push(`${where}.id duplicates "${raw.id}"`);
      seen.add(raw.id);
    }

    if (!Array.isArray(raw.accepts) || raw.accepts.length === 0) {
      errors.push(`${where}.accepts must be a non-empty array`);
    } else {
      raw.accepts.forEach((kind: unknown, kindIndex: number) => {
        if (!ACTION_CONTRIBUTION_KINDS.includes(kind as never)) {
          errors.push(
            `${where}.accepts[${kindIndex}] must be one of: ${ACTION_CONTRIBUTION_KINDS.join(", ")}`,
          );
        }
      });
    }
    if ("descriptionKey" in raw) {
      requireString(raw.descriptionKey, `${where}.descriptionKey`, errors);
    }
  });
}

function validateHostCapability(value: unknown, errors: string[]): void {
  if (value === undefined) return;

  const entries = Array.isArray(value) ? value : [value];
  if (Array.isArray(value) && value.length === 0) {
    errors.push(
      'Field "contributes.hostCapability" must not be an empty array',
    );
    return;
  }

  const seen = new Set<string>();
  entries.forEach((raw, index) => {
    const where = Array.isArray(value)
      ? `contributes.hostCapability[${index}]`
      : "contributes.hostCapability";
    if (!isPlainObject(raw)) {
      errors.push(`${where} must be an object`);
      return;
    }
    rejectUnknown(raw, ["key", "labelKey", "editorTab"], where, errors);

    if (requireString(raw.key, `${where}.key`, errors)) {
      if (seen.has(raw.key))
        errors.push(`${where}.key duplicates "${raw.key}"`);
      seen.add(raw.key);
    }
    requireString(raw.labelKey, `${where}.labelKey`, errors);
    requireString(raw.editorTab, `${where}.editorTab`, errors);
  });
}

export interface ParsedManifest {
  manifest?: PluginManifest;
  errors: string[];
}

/**
 * Validates, then applies the cross-field rules a JSON schema cannot express
 * and fills in the entry-point defaults.
 */
export function parseManifest(raw: unknown): ParsedManifest {
  const errors = validateManifest(raw);
  if (errors.length > 0) return { errors };

  const manifest = raw as PluginManifest;

  if (manifest.engine.api !== SUPPORTED_PLUGIN_API_VERSION) {
    return {
      errors: [
        `Plugin targets SDK API version ${manifest.engine.api}, but this build implements ${SUPPORTED_PLUGIN_API_VERSION}`,
      ],
    };
  }

  // Full ids: provides, providesSecret and actions all name permissions the
  // way an admin sees them, so they are compared against the qualified form.
  const declared = new Set(
    (manifest.contributes?.permissions ?? []).map((permission) =>
      qualifyPermission(manifest.id, permission.name),
    ),
  );

  // A permission the catalog never sees is one no admin can grant, so the
  // service or action would be invisible rather than denied.
  for (const provide of manifest.provides ?? []) {
    if (!declared.has(provide.permission)) {
      errors.push(
        `provides["${provide.service}"].permission "${provide.permission}" is not declared in contributes.permissions`,
      );
    }
  }
  for (const secret of manifest.providesSecret ?? []) {
    if (!declared.has(secret.permission)) {
      errors.push(
        `providesSecret["${secret.key}"].permission "${secret.permission}" is not declared in contributes.permissions`,
      );
    }
  }
  for (const action of manifest.contributes?.actions ?? []) {
    if (action.permission && !declared.has(action.permission)) {
      errors.push(
        `contributes.actions["${action.id}"].permission "${action.permission}" is not declared in contributes.permissions`,
      );
    }
  }
  // A settings field may gate on one of this plugin's own permissions, or on
  // a core/other-plugin id used as given. Only the first form is checkable
  // here, and an undeclared one would hide the field from every admin.
  const settings = manifest.contributes?.settings;
  const settingsScopes: [string, PluginSettingsField[]][] = [
    ["admin", settings?.admin ?? []],
    ["user", settings?.user ?? []],
    ["host", settings?.host?.fields ?? []],
  ];
  for (const [scope, fields] of settingsScopes) {
    for (const field of fields) {
      if (!field.permission) continue;
      if (field.permission.includes(".")) continue;
      if (!declared.has(qualifyPermission(manifest.id, field.permission))) {
        errors.push(
          `contributes.settings.${scope} field "${field.key}" requires permission "${field.permission}", which is not declared in contributes.permissions`,
        );
      }
    }
  }

  for (const secret of manifest.requiresSecret ?? []) {
    if (secret.plugin === manifest.id) {
      errors.push(
        `requiresSecret["${secret.key}"] points at this plugin; use ctx.secrets.get instead`,
      );
    }
  }
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (dependency === manifest.id) {
      errors.push(`dependencies["${dependency}"] points at this plugin`);
    }
    if (manifest.optionalDependencies?.[dependency]) {
      errors.push(
        `"${dependency}" is listed in both dependencies and optionalDependencies`,
      );
    }
  }
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
    if (dependency === manifest.id) {
      errors.push(
        `optionalDependencies["${dependency}"] points at this plugin`,
      );
    }
  }

  if (errors.length > 0) return { errors };

  return {
    manifest: {
      ...manifest,
      backend: manifest.backend ?? DEFAULT_BACKEND_ENTRY,
      frontend: manifest.frontend ?? DEFAULT_FRONTEND_ENTRY,
      locales: manifest.locales ?? DEFAULT_LOCALES_DIR,
    },
    errors: [],
  };
}
