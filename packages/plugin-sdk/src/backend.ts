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
 * Express types, structurally. The SDK does not depend on express: a plugin
 * brings its own copy, and a nominal type from core's would not match it.
 */
export interface PluginRequestLike {
  method: string;
  url: string;
  path: string;
  headers: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PluginResponseLike {
  status: (code: number) => PluginResponseLike;
  json: (body: unknown) => unknown;
  [key: string]: unknown;
}

export type PluginNextFunction = (error?: unknown) => void;

export type PluginMiddleware = (
  req: PluginRequestLike,
  res: PluginResponseLike,
  next: PluginNextFunction,
) => void;

export interface PluginRouterOptions {
  /**
   * Paths served without authentication, relative to the plugin's mount point
   * and matched exactly ("/callback", not "/plugin-api/<id>/callback").
   *
   * For the handful of routes an unauthenticated third party has to reach: an
   * OIDC callback, an inbound webhook. Every entry is audited when the router
   * is registered and every request that uses one is logged, because "this
   * plugin opened a hole in auth" is exactly the thing an operator should be
   * able to find later.
   */
  public?: readonly string[];
  /** Body size limit for JSON and urlencoded bodies. Defaults to "1mb". */
  bodyLimit?: string;
  /**
   * Skips the built-in body parsers entirely, for a router that parses its own
   * (multer, a raw body for signature checking, a proxied stream).
   */
  rawBody?: boolean;
}

/**
 * HTTP routes, served at /plugin-api/<id>/ by the main backend server.
 *
 * No plugin gets its own port or nginx block. Core runs auth, the actor, the
 * enabled check, body limits and an error wrapper in front of every route, so
 * a plugin's router only has to handle its own paths.
 */
export interface PluginHttp {
  /**
   * Returns an Express Router mounted at /plugin-api/<id>/. Call it once in
   * activate and register routes on the result; it is unmounted automatically
   * on deactivate.
   */
  router: <T = unknown>(options?: PluginRouterOptions) => T;
}

/**
 * Core RBAC, as a plugin sees it.
 *
 * Every method takes either a short name this plugin declares
 * ("services.use"), which is prefixed with the plugin id, or a full id
 * belonging to another plugin or a core group, which is used as given. That is
 * what makes a cross-plugin check expressible without letting a plugin gate its
 * own routes on someone else's authority.
 */
export interface PluginRbac {
  /** Whether the user this call is running as holds `permission`. */
  has: (permission: string) => Promise<boolean>;

  /** Whether `userId` holds `permission`. */
  hasFor: (userId: string, permission: string) => Promise<boolean>;

  /**
   * Middleware that rejects a request whose user lacks `permission`.
   *
   * A plugin may only require a permission it declares in
   * contributes.permissions, so a route cannot gate on admin.users.manage and
   * borrow someone else's authority.
   */
  require: (permission: string) => PluginMiddleware;
}

export interface PluginWebSocketConnection {
  /** The authenticated user for this socket. */
  readonly userId: string;
  /** The upgrade request, for query parameters and headers. */
  readonly request: unknown;
  /** The ws WebSocket. Binary frames and backpressure work as usual. */
  readonly socket: unknown;
}

export type PluginWebSocketHandler = (
  connection: PluginWebSocketConnection,
) => void | Promise<void>;

export interface PluginWebSocketOptions {
  /**
   * Serves the upgrade without core authentication. The handler gets an empty
   * userId and must authenticate the socket itself, which is what a share-link
   * guest or a token-in-query protocol needs.
   */
  public?: boolean;
}

/**
 * WebSocket routes, served at /plugin-ws/<id>/<path> through the main server's
 * upgrade event. Every socket a plugin opened is closed on deactivate.
 */
export interface PluginWebSockets {
  route: (
    path: string,
    handler: PluginWebSocketHandler,
    options?: PluginWebSocketOptions,
  ) => void;
  /**
   * Hands the raw upgrade to the plugin, for a library that insists on owning
   * its own WebSocket server (guacamole-lite attaches this way). Auth and the
   * actor still run first.
   */
  upgrade: (
    path: string,
    handler: (
      request: unknown,
      socket: unknown,
      head: unknown,
      userId: string,
    ) => void,
    options?: PluginWebSocketOptions,
  ) => void;
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
  readonly http: PluginHttp;
  readonly ws: PluginWebSockets;
  readonly rbac: PluginRbac;
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
