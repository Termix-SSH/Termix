/**
 * The backend contract: what a plugin's activate(ctx) receives.
 *
 * These are types only. Core builds the real object in
 * src/backend/plugins/ctx.ts and injects it at activation, so the SDK stays a
 * description of the contract rather than an implementation a plugin could
 * reach around.
 *
 * Members marked A3-A8 are not built yet. A plugin written against them today
 * will type-check and fail at runtime, which is the intended signal.
 */

import type { PluginManifest } from "./manifest.js";
import type { PluginTableDefinition } from "./db.js";

/**
 * Thrown when a plugin calls a guarded member without the capability.
 *
 * Two things must be true: the manifest declares it, and it is granted. A
 * grant for something the manifest never declared is ignored, so widening a
 * plugin's reach always needs a new manifest the user can see.
 */
export class PluginCapabilityError extends Error {
  readonly code = "EPLUGINCAP";
  readonly pluginId: string;
  readonly capability: string;

  constructor(pluginId: string, capability: string) {
    super(
      `Plugin "${pluginId}" is not granted the "${capability}" capability. ` +
        `Declare it in the manifest's capabilities array and grant it in the plugin's settings.`,
    );
    this.name = "PluginCapabilityError";
    this.pluginId = pluginId;
    this.capability = capability;
  }
}

export interface PluginLogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, error?: Error) => void;
}

export interface PluginEvents {
  /** Topics are namespaced to plugin.<id>.* unless the plugin holds events:core. */
  emit: (topic: string, payload: unknown) => void;
  on: (topic: string, listener: (payload: unknown) => void) => () => void;
}

/** Small key/value state owned by this plugin. Requires kv:own. */
export interface PluginKeyValue {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  list: () => Promise<string[]>;
}

/**
 * The plugin's own tables.
 *
 * `define` registers a table definition and returns the Drizzle table object
 * to query through `db`. Both require db:own.
 *
 * Scoped by name: every table carries the p_<id>_ prefix, and `refs` exposes
 * users and ssh_data read-only so a plugin can join against them without being
 * able to write them. In-process code could reach around all of this - see
 * "What this protects, and what it does not" in ARCHITECTURE.md. The
 * capability, the prefix, lint and review are the contract, not a sandbox.
 */
export interface PluginDatabase {
  /** Registers a definition and returns its queryable table object. */
  define: <T = unknown>(definition: PluginTableDefinition) => Promise<T>;
  /** Drizzle handle, scoped to this plugin's tables. */
  client: <T = unknown>() => Promise<T>;
  /** Read-only references to the core tables a plugin may point at. */
  refs: <T = unknown>() => Promise<T>;
}

/** A row's shape on the wire, before it is written to a table. */
export type SyncRow = Record<string, unknown>;

export interface SyncEntityReference {
  /** Stored column holding a local numeric id, e.g. "credentialId". */
  field: string;
  /** Wire field holding the portable id, e.g. "credentialSyncId". */
  syncField: string;
  /** The entity the id points at. */
  entityType: string;
}

export interface SyncEntityRegistration {
  /** Stable wire name. Never change it: tombstones and remote rows match on it. */
  type: string;
  /** The table, as returned by ctx.db.define. */
  table: unknown;
  /** Column holding the owning user id. Defaults to "userId". */
  userColumn?: string;
  /** Fields DataCrypto translates between plaintext wire and encrypted row. */
  encryptedFields?: readonly string[];
  /** Local-id to sync-id translations applied on the way out and back. */
  references?: readonly SyncEntityReference[];
  /** Lower sorts first. Reference targets must sort before their referrers. */
  order?: number;
  /** Fields that must never be overwritten by an inbound payload. */
  readOnlyFields?: readonly string[];
  /** One row per user rather than many, keyed on the owner. */
  singleton?: boolean;
  /**
   * Escape hatch for a row whose references are not plain columns, such as ids
   * embedded in a JSON blob. Runs instead of `references`, not alongside it.
   */
  serialize?: (
    row: SyncRow,
    resolveSyncId: (entityType: string, id: number) => Promise<string | null>,
  ) => Promise<SyncRow>;
  deserialize?: (
    row: SyncRow,
    resolveId: (entityType: string, syncId: string) => Promise<number | null>,
  ) => Promise<SyncRow>;
}

/** Adds an entity to remote sync between a desktop backend and a server. */
export interface PluginSync {
  registerEntity: (entity: SyncEntityRegistration) => void;
}

export interface PluginRegistry {
  provide: <T>(key: string, value: T) => void;
  consume: <T>(key: string) => T | undefined;
  revoke: (key: string, value?: unknown) => boolean;
}

export interface PluginServices {
  provide: <T extends object>(service: string, implementation: T) => void;
  get: <T extends object>(service: string, options?: { userId?: string }) => T;
}

export interface PluginSecrets {
  offer: (
    key: string,
    resolve: (userId: string) => Promise<string | null> | string | null,
  ) => void;
  withdraw: (key: string) => boolean;
  getShared: (
    pluginId: string,
    key: string,
    options?: { userId?: string },
  ) => Promise<string | null>;
}

/**
 * Anything the runtime should undo when the plugin deactivates. Everything
 * registered through ctx is tracked automatically; this is for resources a
 * plugin creates itself, such as a server or an interval.
 */
export interface PluginDisposables {
  add: (dispose: () => void | Promise<void>) => void;
}

export interface PluginContext {
  readonly pluginId: string;
  readonly manifest: PluginManifest;
  readonly log: PluginLogger;
  readonly events: PluginEvents;
  readonly kv: PluginKeyValue;
  readonly db: PluginDatabase;
  readonly sync: PluginSync;
  readonly registry: PluginRegistry;
  readonly services: PluginServices;
  readonly secrets: PluginSecrets;
  readonly disposables: PluginDisposables;

  /**
   * Runs `fn` with `userId` as the acting user, for background work that has
   * no request behind it. Always audited, and every core API inside still
   * applies that user's RBAC.
   *
   * This is the only way a plugin can name a user. Nothing else trusts a user
   * id that came from plugin code.
   */
  asUser: <T>(userId: string, fn: () => Promise<T> | T) => Promise<T>;

  /** The acting user for the current call, when there is one. */
  currentActor: () => string | undefined;
}

export type PluginActivate = (ctx: PluginContext) => void | Promise<void>;
export type PluginDeactivate = () => void | Promise<void>;

export interface PluginModule {
  activate: PluginActivate;
  deactivate?: PluginDeactivate;
}

/**
 * Identity helper that gives a plugin entry its types without importing the
 * runtime. Everything a plugin creates belongs inside activate: the module is
 * cached by the ESM loader, so disable-then-enable re-runs activate on the
 * same module object.
 */
export function definePlugin(plugin: PluginModule): PluginModule {
  return plugin;
}

export type { PluginManifest } from "./manifest.js";
export type { PluginTableDefinition } from "./db.js";
