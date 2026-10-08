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
import {
  ENV_NAME_PATTERN,
  MAX_ENV_DESCRIPTION_LENGTH,
  pluginDocsUrl,
  type PluginEnvVar,
} from "./docs.js";

export {
  ENV_NAME_PATTERN,
  MAX_ENV_DESCRIPTION_LENGTH,
  pluginDocsPage,
  pluginDocsUrl,
  pluginEnvVars,
  type PluginEnvVar,
} from "./docs.js";

/**
 * The plugin API this build implements. A minor bump adds to the API and
 * never removes; a major bump may break plugins.
 *
 * engine.api is a semver range checked against this ("1" means any 1.x,
 * "^1.2" needs 1.2 or later). engine.termix is checked against the core
 * version by the server.
 */
export const PLUGIN_API_VERSION = "1.2.0";

/** The API major, the default engine.api for a new plugin. */
export const SUPPORTED_PLUGIN_API_VERSION = String(
  semver.major(PLUGIN_API_VERSION),
);

/** Whether this build's plugin API satisfies a manifest's engine.api. */
export function isApiCompatible(range: string): boolean {
  return (
    semver.validRange(range) !== null &&
    semver.satisfies(PLUGIN_API_VERSION, range)
  );
}

/**
 * Whether a core version satisfies a manifest's engine.termix. A prerelease
 * core (2.9.0-beta.1) counts as that release.
 */
export function isTermixCompatible(
  range: string,
  coreVersion: string | null,
): boolean {
  if (!coreVersion || !semver.valid(semver.coerce(coreVersion))) return true;
  if (semver.validRange(range) === null) return false;
  return semver.satisfies(semver.coerce(coreVersion)!.version, range);
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export const MAX_FEATURES = 20;
export const MAX_FEATURE_LENGTH = 160;

/**
 * The usable feature lines of a manifest or registry entry. Anything that is
 * not a short non-empty string is dropped, so an index cannot flood the page.
 */
export function pluginFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (f): f is string =>
        typeof f === "string" &&
        f.trim().length > 0 &&
        f.length <= MAX_FEATURE_LENGTH,
    )
    .map((f) => f.trim())
    .slice(0, MAX_FEATURES);
}

/**
 * The video id of a YouTube link, or null for anything else. Only the id is
 * ever used, so a manifest can never point the embed at another site.
 */
export function youtubeVideoId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  let id: string | null | undefined;
  if (host === "youtu.be") {
    id = url.pathname.slice(1);
  } else if (url.pathname === "/watch") {
    id = url.searchParams.get("v");
  } else {
    id = /^\/(?:embed|shorts|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

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

export const ACTION_CONTRIBUTION_KINDS = ["button", "component"] as const;
export type ActionContributionKind = (typeof ACTION_CONTRIBUTION_KINDS)[number];

const OPEN_FROM_VALUES = ["rail", "host-context-menu", "palette"] as const;

const ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;

/**
 * Ids no plugin may take. A permission is registered as <id>.<name>, so a
 * plugin called "admin" would mint admin.* permissions and could default them
 * onto the user role; the rest are names core or the runtime already uses.
 */
export const RESERVED_PLUGIN_IDS: readonly string[] = [
  "admin",
  "hosts",
  "credentials",
  "core",
  "termix",
  "plugin",
  "plugins",
  "onboarding",
  "users",
  "system",
  "sdk",
];

/** A preset key is a plain property name, never a prototype one. */
const PRESET_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?(\+[0-9A-Za-z-.]+)?$/;
/** Service names are dotted, e.g. "ssh.transport". */
const SERVICE_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const SECRET_KEY_PATTERN = /^[a-z0-9-]+$/;
/** Action ids name a frontend function, so segments may be camelCase. */
const ACTION_ID_PATTERN = /^[a-z0-9-]+(\.[a-zA-Z0-9-]+)+$/;
const HANDLER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
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
  /** Semver range of Termix releases the plugin runs on, e.g. ">=2.9.0". */
  termix: string;
  /**
   * Semver range of the plugin API it needs, e.g. "1" or "^1.2". Use the
   * lowest minor whose API you call, so older cores refuse it cleanly.
   */
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
 * A sidebar panel or dashboard card the plugin's frontend registers. Declared
 * here so core knows who owns a saved view even while the plugin is off and
 * its code never loaded.
 */
export interface PluginViewContribution {
  id: string;
  titleKey: string;
  icon?: string;
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
  /**
   * Named providers this plugin registers, for a service several plugins
   * provide side by side (sessions.live, keyed by session type). Omitted, the
   * plugin provides it once, unnamed.
   */
  names?: string[];
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
  /**
   * Host scope only: whether the field can have a host default (server,
   * user or folder) that hosts follow until they set their own. On by
   * default for every field except secrets and json fields with
   * `secretKeys`. Turn it off for a value that only makes sense per host,
   * such as a MAC address or an API endpoint.
   */
  defaultable?: boolean;
  /**
   * Host scope only: the levels that may set a default for it. Defaults to
   * all three. Leave "admin" out for a value that points at one user's own
   * rows (a snippet id, a profile id).
   */
  defaultLevels?: Array<"admin" | "user" | "folder">;
  /**
   * Host scope only: a look-and-feel value. When the host follows its
   * defaults, a user it is shared with gets their own defaults for it
   * rather than the owner's.
   */
  personal?: boolean;
  /**
   * Host scope only: the lowest share level whose recipients see this value
   * in the host payload. Defaults to "connect", everyone who sees the host.
   */
  shareRead?: "connect" | "view" | "edit" | "manage";
  /** Host scope only: only the host's owner may change it. */
  ownerOnly?: boolean;
  /**
   * JSON fields only: keys inside the stored object that hold secrets, such
   * as a gateway password. Core clears them from exports like any secret.
   */
  secretKeys?: string[];
  /**
   * Stored and validated like any field, but not drawn by the generic
   * settings form, because the plugin edits it in its own UI (a host editor
   * section).
   */
  hidden?: boolean;
}

export interface PluginHostSettingsContribution {
  /** Boolean field rendered first, gating the rest of the section. */
  enableKey?: string;
  enableLabelKey?: string;
  enableDescriptionKey?: string;
  /** What the enable switch reads before a host saves it. Off by default. */
  enableDefault?: boolean;
  /** Host editor strip the generated tab sits in. Defaults to "top". */
  editorGroup?: "top" | "ssh";
  /** Position among that strip's tabs, core ones included. */
  editorOrder?: number;
  fields: PluginSettingsField[];
}

export interface PluginSettingsContribution {
  admin?: PluginSettingsField[];
  user?: PluginSettingsField[];
  host?: PluginHostSettingsContribution;
}

/**
 * What a plugin adds to sign-in and SSH auth. Declared so core can tell who
 * owns an auth type or factor even while the plugin is disabled, and so the
 * login screen knows which bundles it needs before anyone has signed in.
 */
export interface PluginAuthContribution {
  /** Values of ssh_data.auth_type this plugin provides. */
  sshAuthTypes?: string[];
  /** Login method ids. */
  loginMethods?: string[];
  /** Second factor ids. */
  secondFactors?: string[];
  /** Schemes this plugin resolves for "<scheme>://..." secret references, e.g. "op". */
  secretSchemes?: string[];
  /** Keyboard-interactive handler ids, e.g. "warpgate". */
  keyboardInteractive?: string[];
}

export interface PluginContributions {
  tabs?: PluginTabContribution[];
  panels?: PluginViewContribution[];
  dashboardCards?: PluginViewContribution[];
  /**
   * The frontend also runs on anonymous guest pages (shared-session and
   * collab links), where it is activated with app.guest set.
   */
  guest?: boolean;
  /**
   * `?view=` names an anonymous guest page may open. Each must be served by a
   * tab's `standalone` component. Needs `guest: true`.
   */
  guestViews?: string[];
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
  auth?: PluginAuthContribution;
  http?: PluginHttpContribution;
  /**
   * This plugin's Appearance defaults for each interface preset, read in the
   * frontend with usePluginUiPreferences. Every preset names the same keys;
   * values are booleans, numbers, strings or string arrays.
   */
  uiPresets?: Record<
    "simple" | "balanced" | "advanced",
    Record<string, unknown>
  >;
  /**
   * Wire names of the sync entities this plugin registers with
   * ctx.sync.registerEntity, so a server can name them while the plugin is
   * off and a desktop can list them in its sync settings.
   */
  syncEntities?: string[];
  /**
   * Other plugins' action, slot and extension point ids this plugin calls,
   * fills or extends. Declaration only: nothing breaks when the owner is
   * missing, but the coupling is written down where tools and people can
   * see it.
   */
  uses?: string[];
  /**
   * Keybinding actions this plugin adds to Appearance > Keybindings, with
   * the parameters a saved binding carries. Core validates saved bindings
   * against these without running plugin code, and translates a parameter
   * naming a sync entity over sync.
   */
  keybindingActions?: PluginKeybindingActionContribution[];
  /**
   * Connection protocols whose per-host login core stores, encrypts,
   * shares, exports and syncs for this plugin, read back with
   * ctx.credentials.resolveHostProtocol.
   */
  protocols?: PluginProtocolContribution[];
}

/** A field a protocol login carries besides username and password. */
export interface PluginProtocolCredentialField {
  key: string;
  /** Encrypted with the owner's data key and never sent to a browser. */
  secret?: boolean;
}

export interface PluginProtocolContribution {
  /** Stored with each login. Never change it once hosts use it. */
  id: string;
  credentialFields?: PluginProtocolCredentialField[];
  /**
   * The port an import row without one gets, for a host whose main
   * protocol this is.
   */
  defaultPort?: number;
  /**
   * What the owner's login falls back to from the host's own SSH login
   * when the protocol login leaves it empty. The password only falls back
   * while the host signs in to SSH with a password.
   */
  hostLoginFallback?: Array<"username" | "password">;
}

/** Protocol ids core keeps for itself. */
export const RESERVED_PROTOCOL_IDS: readonly string[] = ["ssh"];

/** Login keys a declared credential field may not reuse. */
export const RESERVED_PROTOCOL_FIELD_KEYS: readonly string[] = [
  "username",
  "password",
  "authType",
  "credentialId",
];

/** One parameter a saved keybinding action carries next to its type. */
export interface PluginKeybindingParam {
  type: "string" | "boolean";
  required?: boolean;
  /** A regular expression a string value must match. */
  pattern?: string;
  maxLength?: number;
  /**
   * The value is a local row id of this sync entity, stored as a string.
   * Sync sends the row's syncId instead.
   */
  syncEntity?: string;
}

export interface PluginKeybindingActionContribution {
  /**
   * Stored as the binding's action.type. New actions use
   * "<plugin id>.<name>"; the bundled ones keep their 2.8 names.
   */
  id: string;
  params?: Record<string, PluginKeybindingParam>;
}

/** Keybinding action types the shell runs itself; no plugin may declare them. */
export const CORE_KEYBINDING_ACTIONS: readonly string[] = [
  "nextTab",
  "previousTab",
  "openCommandPalette",
  "reconnectSession",
];

/**
 * How a desktop linked to a server treats this plugin.
 * - "mirror": follows the server, installed and switched on or off with it.
 * - "local": each desktop decides for itself (a serial port is local).
 * - "server": only makes sense on a server, never runs on a linked desktop.
 */
export type PluginDesktopMode = "mirror" | "local" | "server";
export const PLUGIN_DESKTOP_MODES: readonly PluginDesktopMode[] = [
  "mirror",
  "local",
  "server",
];

export interface PluginHttpContribution {
  /**
   * Old URLs something outside Termix still calls (a webhook a third party
   * posts to). Each must start with "/<plugin id>/"; a request under it is
   * served by this plugin's router with that prefix removed, so
   * "/automations/webhook/x" reaches the route "/webhook/x". Core routes win
   * a clash.
   */
  legacyPaths?: string[];
  /**
   * Old URLs outside the plugin's namespace that something outside Termix
   * still sends people to (an identity provider's callback, a published
   * resolver URL). A request at `from`, or under it, is redirected to `to`
   * under /plugin-api/<id>/ with the rest of the path and the query kept.
   * Core routes win a clash.
   */
  legacyRedirects?: PluginLegacyRedirect[];
  /**
   * An admin may call this plugin's routes on behalf of another user with
   * the X-Admin-Target-User header (the admin "manage user" panel). Without
   * it core refuses the header on every route under /plugin-api/<id>/.
   */
  adminImpersonation?: boolean;
}

export interface PluginLegacyRedirect {
  /** An absolute path, e.g. "/users/oidc/callback". */
  from: string;
  /** A path in this plugin's router, e.g. "/callback". */
  to: string;
  /** 307 (the default) or 308 for a permanent move. */
  status?: 307 | 308;
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
  /** A YouTube link shown at the top of the plugin's page. */
  video?: string;
  /** Short lines listing what the plugin does, shown on its page. */
  features?: string[];
  /** Where the plugin's docs live. https only. */
  docs?: string;
  /** Environment variables the plugin reads. */
  env?: PluginEnvVar[];
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
  /**
   * Bare npm package names carrying a native (.node) binding. The CLI build
   * never bundles them: they stay a real dependency in the plugin's own
   * package.json and are resolved from node_modules at runtime instead,
   * because esbuild bundling a native addon breaks the relative path it uses
   * to locate its compiled binary.
   */
  nativeDependencies?: string[];
  /** How a linked desktop treats this plugin. Defaults to "mirror". */
  desktop?: PluginDesktopMode;
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
  "video",
  "features",
  "docs",
  "env",
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
  "nativeDependencies",
  "desktop",
]);

const ALLOWED_CONTRIBUTES = new Set([
  "tabs",
  "panels",
  "dashboardCards",
  "guest",
  "guestViews",
  "actions",
  "actionSlots",
  "permissions",
  "settings",
  "hostCapability",
  "http",
  "uiPresets",
  "auth",
  "syncEntities",
  "uses",
  "keybindingActions",
  "protocols",
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
  "hidden",
  "defaultable",
  "defaultLevels",
  "personal",
  "shareRead",
  "ownerOnly",
  "secretKeys",
];

const SHARE_LEVELS = ["connect", "view", "edit", "manage"];

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

/**
 * A path inside the plugin folder. Absolute paths, ".." and backslashes are
 * refused so an entry point or asset folder cannot point outside the plugin.
 */
function requireRelativePath(
  value: string,
  where: string,
  errors: string[],
): void {
  const segments = value.split("/");
  if (
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.includes("\\") ||
    value.includes("\0") ||
    segments.includes("..") ||
    segments.every((segment) => segment === "" || segment === ".")
  ) {
    errors.push(
      `Field "${where}" must be a relative path inside the plugin, got: ${JSON.stringify(value)}`,
    );
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
    } else if (RESERVED_PLUGIN_IDS.includes(m.id)) {
      errors.push(`Field "id" may not be "${m.id}": that name is reserved`);
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
  if ("video" in m && youtubeVideoId(m.video) === null) {
    errors.push(
      `Field "video" must be a YouTube link such as https://www.youtube.com/watch?v=..., got: ${JSON.stringify(m.video)}`,
    );
  }
  validateFeatures(m.features, errors);
  if ("docs" in m && pluginDocsUrl(m.docs) === null) {
    errors.push(
      `Field "docs" must be an https URL, got: ${JSON.stringify(m.docs)}`,
    );
  }
  validateEnv(m.env, errors);
  for (const field of ["backend", "frontend", "locales"] as const) {
    if (field in m && requireString(m[field], field, errors)) {
      requireRelativePath(m[field] as string, field, errors);
    }
  }

  validateAuthor(m.author, errors);
  validateEngine(m.engine, errors);
  validateCategory(m.category, errors);
  validateCapabilities(m.capabilities, errors);
  validatePlatforms(m.platforms, errors);
  validateNativeDependencies(m.nativeDependencies, errors);
  if (
    m.desktop !== undefined &&
    !PLUGIN_DESKTOP_MODES.includes(m.desktop as PluginDesktopMode)
  ) {
    errors.push(
      `Field "desktop" must be one of: ${PLUGIN_DESKTOP_MODES.join(", ")}`,
    );
  }
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

function validateFeatures(features: unknown, errors: string[]): void {
  if (features === undefined) return;
  if (!Array.isArray(features)) {
    errors.push('Field "features" must be an array of strings');
    return;
  }
  if (features.length > MAX_FEATURES) {
    errors.push(`Field "features" may list at most ${MAX_FEATURES} items`);
  }
  features.forEach((feature, i) => {
    if (
      typeof feature !== "string" ||
      feature.trim().length === 0 ||
      feature.length > MAX_FEATURE_LENGTH
    ) {
      errors.push(
        `Field "features[${i}]" must be a non-empty string of at most ${MAX_FEATURE_LENGTH} characters`,
      );
    }
  });
}

function validateEnv(env: unknown, errors: string[]): void {
  if (env === undefined) return;
  if (!Array.isArray(env)) {
    errors.push('Field "env" must be an array');
    return;
  }
  const seen = new Set<string>();
  env.forEach((entry, i) => {
    const where = `env[${i}]`;
    if (!isPlainObject(entry)) {
      errors.push(`Field "${where}" must be an object`);
      return;
    }
    rejectUnknown(
      entry,
      ["name", "description", "default", "required", "secret"],
      where,
      errors,
    );
    if (typeof entry.name !== "string" || !ENV_NAME_PATTERN.test(entry.name)) {
      errors.push(
        `Field "${where}.name" must be an uppercase name like MY_PLUGIN_URL, got: ${JSON.stringify(entry.name)}`,
      );
    } else if (seen.has(entry.name)) {
      errors.push(`Field "${where}.name" repeats ${entry.name}`);
    } else {
      seen.add(entry.name);
    }
    if (
      typeof entry.description !== "string" ||
      entry.description.trim().length === 0 ||
      entry.description.length > MAX_ENV_DESCRIPTION_LENGTH
    ) {
      errors.push(
        `Field "${where}.description" must be a non-empty string of at most ${MAX_ENV_DESCRIPTION_LENGTH} characters`,
      );
    }
    if ("default" in entry && typeof entry.default !== "string") {
      errors.push(`Field "${where}.default" must be a string`);
    }
    for (const flag of ["required", "secret"] as const) {
      if (flag in entry && typeof entry[flag] !== "boolean") {
        errors.push(`Field "${where}.${flag}" must be true or false`);
      }
    }
  });
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
  if (
    typeof engine.termix === "string" &&
    semver.validRange(engine.termix) === null
  ) {
    errors.push(
      `Field "engine.termix" must be a semver range, got: ${JSON.stringify(engine.termix)}`,
    );
  }
  if (
    typeof engine.api !== "string" ||
    semver.validRange(engine.api) === null
  ) {
    errors.push(
      `Field "engine.api" must be a semver range such as "1" or "^1.2", got: ${JSON.stringify(engine.api)}`,
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

function validateNativeDependencies(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(
      'Field "nativeDependencies" must be a non-empty array when present',
    );
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      errors.push(`nativeDependencies[${index}] must be a non-empty string`);
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
    rejectUnknown(
      raw,
      ["service", "version", "permission", "names"],
      where,
      errors,
    );

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
    if (raw.names !== undefined) {
      validateNameList(raw.names, `${where}.names`, errors);
    }
  });
}

const PROVIDER_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

function validateSyncEntities(value: unknown, errors: string[]) {
  const where = "contributes.syncEntities";
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${where} must be a non-empty array`);
    return;
  }
  const seen = new Set<string>();
  for (const name of value) {
    if (typeof name !== "string" || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) {
      errors.push(`${where} entries must be letters and digits`);
      continue;
    }
    if (seen.has(name)) errors.push(`${where} duplicates "${name}"`);
    seen.add(name);
  }
}

function validateUses(value: unknown, errors: string[]) {
  const where = "contributes.uses";
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${where} must be a non-empty array`);
    return;
  }
  const seen = new Set<string>();
  for (const id of value) {
    if (
      typeof id !== "string" ||
      !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(id)
    ) {
      errors.push(
        `${where} entries must be dotted ids such as "terminal.open"`,
      );
      continue;
    }
    if (seen.has(id)) errors.push(`${where} duplicates "${id}"`);
    seen.add(id);
  }
}

function validateNameList(value: unknown, where: string, errors: string[]) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${where} must be a non-empty array`);
    return;
  }
  const seen = new Set<string>();
  for (const name of value) {
    if (typeof name !== "string" || !PROVIDER_NAME_PATTERN.test(name)) {
      errors.push(`${where} entries must be lowercase names`);
      continue;
    }
    if (seen.has(name)) errors.push(`${where} duplicates "${name}"`);
    seen.add(name);
  }
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
  validateViews(contributes.panels, "panels", errors);
  validateViews(contributes.dashboardCards, "dashboardCards", errors);
  if (
    contributes.guest !== undefined &&
    typeof contributes.guest !== "boolean"
  ) {
    errors.push('Field "contributes.guest" must be a boolean');
  }
  if (contributes.guestViews !== undefined) {
    validateNameList(contributes.guestViews, "contributes.guestViews", errors);
    if (contributes.guest !== true) {
      errors.push('Field "contributes.guestViews" needs "contributes.guest"');
    }
  }
  if (contributes.syncEntities !== undefined) {
    validateSyncEntities(contributes.syncEntities, errors);
  }
  if (contributes.uses !== undefined) {
    validateUses(contributes.uses, errors);
  }
  validatePermissions(contributes.permissions, pluginId, errors);
  validateActions(contributes.actions, errors);
  validateActionSlots(contributes.actionSlots, errors);
  validateSettings(contributes.settings, errors);
  validateHostCapability(contributes.hostCapability, errors);
  validateAuthContribution(contributes.auth, errors);
  validateHttpContribution(contributes.http, pluginId, errors);
  validateUiPresets(contributes.uiPresets, errors);
  validateKeybindingActions(contributes.keybindingActions, errors);
  validateProtocols(contributes.protocols, errors);
}

export const PROTOCOL_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
export const PROTOCOL_FIELD_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;

function validateProtocols(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  const where = "contributes.protocols";
  if (!Array.isArray(value)) {
    errors.push(`Field "${where}" must be an array`);
    return;
  }
  const seen = new Set<string>();
  value.forEach((raw, index) => {
    const at = `${where}[${index}]`;
    if (!isPlainObject(raw)) {
      errors.push(`${at} must be an object`);
      return;
    }
    rejectUnknown(
      raw,
      ["id", "credentialFields", "defaultPort", "hostLoginFallback"],
      at,
      errors,
    );
    if (typeof raw.id !== "string" || !PROTOCOL_ID_PATTERN.test(raw.id)) {
      errors.push(
        `${at}.id must be lowercase letters, digits and dashes, starting with a letter`,
      );
    } else if (RESERVED_PROTOCOL_IDS.includes(raw.id)) {
      errors.push(`${at}.id "${raw.id}" belongs to core`);
    } else {
      if (seen.has(raw.id)) errors.push(`${at}.id duplicates "${raw.id}"`);
      seen.add(raw.id);
    }
    if (
      raw.defaultPort !== undefined &&
      (typeof raw.defaultPort !== "number" ||
        !Number.isInteger(raw.defaultPort) ||
        raw.defaultPort < 1 ||
        raw.defaultPort > 65535)
    ) {
      errors.push(`${at}.defaultPort must be a port number`);
    }
    if (raw.hostLoginFallback !== undefined) {
      if (
        !Array.isArray(raw.hostLoginFallback) ||
        raw.hostLoginFallback.some(
          (entry) => entry !== "username" && entry !== "password",
        )
      ) {
        errors.push(
          `${at}.hostLoginFallback must list "username" and/or "password"`,
        );
      }
    }
    if (raw.credentialFields === undefined) return;
    if (!Array.isArray(raw.credentialFields)) {
      errors.push(`${at}.credentialFields must be an array`);
      return;
    }
    const keys = new Set<string>();
    raw.credentialFields.forEach((field, fieldIndex) => {
      const fieldAt = `${at}.credentialFields[${fieldIndex}]`;
      if (!isPlainObject(field)) {
        errors.push(`${fieldAt} must be an object`);
        return;
      }
      rejectUnknown(field, ["key", "secret"], fieldAt, errors);
      if (
        typeof field.key !== "string" ||
        !PROTOCOL_FIELD_KEY_PATTERN.test(field.key)
      ) {
        errors.push(`${fieldAt}.key must be letters and digits`);
      } else if (RESERVED_PROTOCOL_FIELD_KEYS.includes(field.key)) {
        errors.push(`${fieldAt}.key "${field.key}" is part of every login`);
      } else {
        if (keys.has(field.key)) {
          errors.push(`${fieldAt}.key duplicates "${field.key}"`);
        }
        keys.add(field.key);
      }
      if (field.secret !== undefined && typeof field.secret !== "boolean") {
        errors.push(`${fieldAt}.secret must be a boolean`);
      }
    });
  });
}

const KEYBINDING_ACTION_PATTERN = /^[a-zA-Z][a-zA-Z0-9.-]{0,63}$/;
const KEYBINDING_PARAM_PATTERN = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;

function validateKeybindingParam(
  param: unknown,
  at: string,
  errors: string[],
): void {
  if (!isPlainObject(param)) {
    errors.push(`${at} must be an object`);
    return;
  }
  rejectUnknown(
    param,
    ["type", "required", "pattern", "maxLength", "syncEntity"],
    at,
    errors,
  );
  if (param.type !== "string" && param.type !== "boolean") {
    errors.push(`${at}.type must be "string" or "boolean"`);
  }
  if (param.required !== undefined && typeof param.required !== "boolean") {
    errors.push(`${at}.required must be a boolean`);
  }
  if (param.pattern !== undefined) {
    let valid = typeof param.pattern === "string";
    if (valid) {
      try {
        new RegExp(param.pattern as string);
      } catch {
        valid = false;
      }
    }
    if (!valid) errors.push(`${at}.pattern must be a regular expression`);
  }
  if (
    param.maxLength !== undefined &&
    (typeof param.maxLength !== "number" ||
      !Number.isInteger(param.maxLength) ||
      param.maxLength < 1)
  ) {
    errors.push(`${at}.maxLength must be a positive integer`);
  }
  if (param.syncEntity !== undefined) {
    if (
      typeof param.syncEntity !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9]*$/.test(param.syncEntity)
    ) {
      errors.push(`${at}.syncEntity must be a sync entity wire name`);
    } else if (param.type !== "string") {
      errors.push(`${at}.syncEntity needs a string parameter`);
    }
  }
}

function validateKeybindingActions(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  const where = "contributes.keybindingActions";
  if (!Array.isArray(value)) {
    errors.push(`Field "${where}" must be an array`);
    return;
  }
  const seen = new Set<string>();
  value.forEach((raw, index) => {
    const at = `${where}[${index}]`;
    if (!isPlainObject(raw)) {
      errors.push(`${at} must be an object`);
      return;
    }
    rejectUnknown(raw, ["id", "params"], at, errors);
    if (typeof raw.id !== "string" || !KEYBINDING_ACTION_PATTERN.test(raw.id)) {
      errors.push(`${at}.id must be letters, digits, dots and dashes`);
    } else if (CORE_KEYBINDING_ACTIONS.includes(raw.id)) {
      errors.push(`${at}.id "${raw.id}" is one of the shell's own actions`);
    } else {
      if (seen.has(raw.id)) errors.push(`${at}.id duplicates "${raw.id}"`);
      seen.add(raw.id);
    }
    if (raw.params === undefined) return;
    if (!isPlainObject(raw.params)) {
      errors.push(`${at}.params must be an object`);
      return;
    }
    for (const [name, param] of Object.entries(raw.params)) {
      if (!KEYBINDING_PARAM_PATTERN.test(name) || name === "type") {
        errors.push(`${at}.params.${name} is not a valid parameter name`);
      }
      validateKeybindingParam(param, `${at}.params.${name}`, errors);
    }
  });
}

/**
 * Checks one saved keybinding action against the parameters its declaration
 * lists. A parameter the declaration does not list is refused, so a binding
 * cannot carry arbitrary data under a declared type.
 */
export function validateKeybindingActionParams(
  action: Record<string, unknown>,
  declaration: PluginKeybindingActionContribution,
): boolean {
  const params = declaration.params ?? {};
  for (const key of Object.keys(action)) {
    if (key !== "type" && !(key in params) && action[key] != null) {
      return false;
    }
  }
  for (const [name, param] of Object.entries(params)) {
    const value = action[name];
    if (value === undefined || value === null) {
      if (param.required) return false;
      continue;
    }
    if (param.type === "boolean") {
      if (typeof value !== "boolean") return false;
      continue;
    }
    if (typeof value !== "string") return false;
    if (param.required && value.length === 0) return false;
    if (value.length > (param.maxLength ?? 65_536)) return false;
    if (param.pattern && !new RegExp(param.pattern).test(value)) return false;
  }
  return true;
}

function isPresetValue(value: unknown): boolean {
  return (
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "string" ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function validateUiPresets(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  const where = "contributes.uiPresets";
  if (!isPlainObject(value)) {
    errors.push(`Field "${where}" must be an object`);
    return;
  }
  rejectUnknown(value, ["simple", "balanced", "advanced"], where, errors);
  let keys: string | undefined;
  for (const level of ["simple", "balanced", "advanced"]) {
    const preset = value[level];
    if (!isPlainObject(preset)) {
      errors.push(`${where}.${level} must be an object`);
      continue;
    }
    for (const [key, entry] of Object.entries(preset)) {
      if (!PRESET_KEY_PATTERN.test(key)) {
        errors.push(
          `${where}.${level} has an invalid key ${JSON.stringify(key)}`,
        );
      }
      if (!isPresetValue(entry)) {
        errors.push(
          `${where}.${level}.${key} must be a boolean, number, string or string array`,
        );
      }
    }
    const names = Object.keys(preset).sort().join(",");
    if (keys === undefined) keys = names;
    else if (keys !== names) {
      errors.push(`${where} presets must all name the same keys`);
    }
  }
}

const LEGACY_PATH_PATTERN = /^\/[a-z][a-z0-9-]*(\/[A-Za-z0-9_.-]+)+$/;
const REDIRECT_PATH_PATTERN = /^(\/[A-Za-z0-9_.-]+)+$/;
const RESERVED_PREFIXES = ["/plugin-api", "/plugin-ws", "/plugin-assets"];

function validateLegacyRedirects(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('Field "contributes.http.legacyRedirects" must be an array');
    return;
  }
  value.forEach((entry, index) => {
    const at = `contributes.http.legacyRedirects[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }
    rejectUnknown(entry, ["from", "to", "status"], at, errors);
    const { from, to, status } = entry;
    if (typeof from !== "string" || !REDIRECT_PATH_PATTERN.test(from)) {
      errors.push(`${at}.from must be an absolute path`);
    } else if (
      RESERVED_PREFIXES.some(
        (prefix) => from === prefix || from.startsWith(`${prefix}/`),
      )
    ) {
      errors.push(`${at}.from cannot be under ${from.split("/")[1]}`);
    }
    if (typeof to !== "string" || !REDIRECT_PATH_PATTERN.test(to)) {
      errors.push(`${at}.to must be a path in the plugin's router`);
    }
    if (status !== undefined && status !== 307 && status !== 308) {
      errors.push(`${at}.status must be 307 or 308`);
    }
  });
}

function validateHttpContribution(
  value: unknown,
  pluginId: string | undefined,
  errors: string[],
): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push('Field "contributes.http" must be an object');
    return;
  }
  rejectUnknown(
    value,
    ["legacyPaths", "legacyRedirects", "adminImpersonation"],
    "contributes.http",
    errors,
  );
  if (
    value.adminImpersonation !== undefined &&
    typeof value.adminImpersonation !== "boolean"
  ) {
    errors.push(
      'Field "contributes.http.adminImpersonation" must be a boolean',
    );
  }
  validateLegacyRedirects(value.legacyRedirects, errors);
  const paths = value.legacyPaths;
  if (paths === undefined) return;
  if (!Array.isArray(paths)) {
    errors.push('Field "contributes.http.legacyPaths" must be an array');
    return;
  }
  paths.forEach((path, index) => {
    const at = `contributes.http.legacyPaths[${index}]`;
    if (typeof path !== "string" || !LEGACY_PATH_PATTERN.test(path)) {
      errors.push(`${at} must be an absolute path like "/<plugin id>/name"`);
      return;
    }
    if (pluginId && !path.startsWith(`/${pluginId}/`)) {
      errors.push(`${at} must start with "/${pluginId}/"`);
    }
  });
}

const AUTH_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

function validateAuthContribution(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push('Field "contributes.auth" must be an object');
    return;
  }
  rejectUnknown(
    value,
    [
      "sshAuthTypes",
      "loginMethods",
      "secondFactors",
      "secretSchemes",
      "keyboardInteractive",
    ],
    "contributes.auth",
    errors,
  );
  for (const key of [
    "sshAuthTypes",
    "loginMethods",
    "secondFactors",
    "secretSchemes",
    "keyboardInteractive",
  ]) {
    const list = value[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      errors.push(`Field "contributes.auth.${key}" must be an array`);
      continue;
    }
    const seen = new Set<string>();
    list.forEach((entry, index) => {
      if (typeof entry !== "string" || !AUTH_ID_PATTERN.test(entry)) {
        errors.push(
          `Field "contributes.auth.${key}[${index}]" must be a lowercase id (letters, digits and dashes)`,
        );
        return;
      }
      if (seen.has(entry)) {
        errors.push(`Duplicate "${entry}" in contributes.auth.${key}`);
      }
      seen.add(entry);
    });
  }
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
      [
        "enableKey",
        "enableLabelKey",
        "enableDescriptionKey",
        "enableDefault",
        "editorGroup",
        "editorOrder",
        "fields",
      ],
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
    if ("enableDescriptionKey" in host) {
      requireString(
        host.enableDescriptionKey,
        `${at}.enableDescriptionKey`,
        errors,
      );
    }
    if ("enableDefault" in host && typeof host.enableDefault !== "boolean") {
      errors.push(`${at}.enableDefault must be a boolean`);
    }
    if (
      "editorGroup" in host &&
      host.editorGroup !== "top" &&
      host.editorGroup !== "ssh"
    ) {
      errors.push(`${at}.editorGroup must be "top" or "ssh"`);
    }
    if (
      "editorOrder" in host &&
      (typeof host.editorOrder !== "number" ||
        !Number.isFinite(host.editorOrder))
    ) {
      errors.push(`${at}.editorOrder must be a number`);
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

    host.fields.forEach((raw, index) => {
      if (!isPlainObject(raw)) return;
      const fieldAt = `${at}.fields[${index}]`;
      for (const flag of ["defaultable", "personal"]) {
        if (flag in raw && typeof raw[flag] !== "boolean") {
          errors.push(`${fieldAt}.${flag} must be a boolean`);
        }
      }
      if ("defaultLevels" in raw) {
        const levels = raw.defaultLevels;
        if (
          !Array.isArray(levels) ||
          levels.length === 0 ||
          levels.some(
            (level) => !["admin", "user", "folder"].includes(level as string),
          )
        ) {
          errors.push(
            `${fieldAt}.defaultLevels must be a non-empty array of "admin", "user" or "folder"`,
          );
        }
      }
      if (raw.type === "secret" && raw.defaultable === true) {
        errors.push(`${fieldAt} is a secret and cannot be defaultable`);
      }
      if (
        "shareRead" in raw &&
        !SHARE_LEVELS.includes(raw.shareRead as string)
      ) {
        errors.push(
          `${fieldAt}.shareRead must be one of: ${SHARE_LEVELS.join(", ")}`,
        );
      }
      if ("ownerOnly" in raw && typeof raw.ownerOnly !== "boolean") {
        errors.push(`${fieldAt}.ownerOnly must be a boolean`);
      }
      if ("secretKeys" in raw) {
        const keys = raw.secretKeys;
        if (raw.type !== "json") {
          errors.push(`${fieldAt}.secretKeys is only valid on json fields`);
        } else if (
          !Array.isArray(keys) ||
          keys.length === 0 ||
          keys.some((key) => typeof key !== "string" || key.length === 0)
        ) {
          errors.push(`${fieldAt}.secretKeys must be a non-empty string array`);
        }
      }
    });
  }
  for (const scope of ["admin", "user"] as const) {
    const fields = settings[scope];
    if (!Array.isArray(fields)) continue;
    fields.forEach((raw, index) => {
      if (!isPlainObject(raw)) return;
      for (const key of [
        "defaultable",
        "defaultLevels",
        "personal",
        "shareRead",
        "ownerOnly",
      ]) {
        if (key in raw) {
          errors.push(
            `${where}.${scope}[${index}].${key} is only valid on host fields`,
          );
        }
      }
    });
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
    if ("hidden" in raw && typeof raw.hidden !== "boolean") {
      errors.push(`${at}.hidden must be a boolean`);
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

function validateViews(views: unknown, field: string, errors: string[]): void {
  if (views === undefined) return;
  if (!Array.isArray(views)) {
    errors.push(`Field "contributes.${field}" must be an array`);
    return;
  }
  const seen = new Set<string>();
  views.forEach((raw, index) => {
    const where = `contributes.${field}[${index}]`;
    if (!isPlainObject(raw)) {
      errors.push(`${where} must be an object`);
      return;
    }
    rejectUnknown(raw, ["id", "titleKey", "icon"], where, errors);
    if (requireString(raw.id, `${where}.id`, errors)) {
      if (seen.has(raw.id)) errors.push(`${where}.id duplicates "${raw.id}"`);
      seen.add(raw.id);
    }
    requireString(raw.titleKey, `${where}.titleKey`, errors);
    if (raw.icon !== undefined)
      requireString(raw.icon, `${where}.icon`, errors);
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

  if (!isApiCompatible(manifest.engine.api)) {
    return {
      errors: [
        `Plugin needs plugin API ${manifest.engine.api}, but this build implements ${PLUGIN_API_VERSION}`,
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

  const auth = manifest.contributes?.auth;
  const contributesAuth =
    (auth?.sshAuthTypes?.length ?? 0) +
      (auth?.loginMethods?.length ?? 0) +
      (auth?.secondFactors?.length ?? 0) +
      (auth?.secretSchemes?.length ?? 0) +
      (auth?.keyboardInteractive?.length ?? 0) >
    0;
  if (contributesAuth && !manifest.capabilities.includes("auth:provide")) {
    errors.push(
      'contributes.auth needs the "auth:provide" capability in the capabilities array',
    );
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
