/**
 * The backend contract: what a plugin's activate(ctx) receives.
 *
 * These are types only. Core builds the real object in
 * src/backend/plugins/ctx.ts and injects it at activation, so the SDK stays a
 * description of the contract rather than an implementation a plugin could
 * reach around.
 *
 * ctx.ssh is the part of step B's host surface that A8 needed early, so plugin
 * transports could leave core's internals behind.
 */

import type { PluginManifest, PluginSettingsField } from "./manifest.js";
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

/**
 * Thrown by a login method or second factor to refuse a sign-in with a
 * message the user can see. `code` is a stable id the login screen can map to
 * its own text; `status` is the HTTP status for form methods.
 */
export class LoginMethodError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status = 401, code?: string) {
    super(message);
    this.name = "LoginMethodError";
    this.status = status;
    this.code = code;
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
 * A folder on disk this plugin owns, for state too large for ctx.kv (session
 * recordings, uploaded files). Requires files:own.
 */
export interface PluginFiles {
  /**
   * The plugin's own folder under DATA_DIR, created if it does not exist yet.
   * Always the same path for this plugin; a plugin lays out its own
   * subdirectories underneath it.
   */
  dataDir: () => Promise<string>;
}

/**
 * The plugin's own tables.
 *
 * `define` registers a table definition and returns the Drizzle table object
 * to query through `db`. Both require db:own.
 *
 * Scoped by name: every table carries the p_<id>_ prefix, and `refs` exposes
 * users, ssh_data, roles and user_roles read-only so a plugin can join against
 * them without being able to write them. In-process code could reach around
 * all of this - see "What this protects, and what it does not" in
 * ARCHITECTURE.md. The capability, the prefix, lint and review are the
 * contract, not a sandbox.
 */
export interface PluginDatabase {
  /** Registers a definition and returns its queryable table object. */
  define: <T = unknown>(definition: PluginTableDefinition) => Promise<T>;
  /** Drizzle handle, scoped to this plugin's tables. */
  client: <T = unknown>() => Promise<T>;
  /** Read-only references to the core tables a plugin may point at. */
  refs: <T = unknown>() => Promise<T>;
  /**
   * Flushes writes to disk. Call it after every write: on SQLite the database
   * lives in memory and is saved to its encrypted file only when asked, so a
   * write without it can be lost on restart. A no-op on Postgres and MySQL.
   */
  persist: (options?: {
    /**
     * Mark the database dirty and let the debounced save pick it up, rather
     * than saving now. For frequent, low-value writes such as samples, where
     * losing a couple of seconds on a crash is fine.
     */
    lazy?: boolean;
  }) => Promise<void>;
  /**
   * The engine the server runs on. Table objects encode the same on all
   * three, but MySQL has no RETURNING, so portable code reads a written row
   * back by its key rather than relying on .returning().
   */
  readonly dialect: "sqlite" | "postgres" | "mysql";
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
   * Rows this returns false for are left out of sync in both directions, for
   * state that belongs to one install (a per-device "last session").
   */
  shouldSync?: (row: SyncRow) => boolean;
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
  /**
   * Records that a row was deleted, so a pull on the other side of remote
   * sync removes it too. Call it with the row's syncId right after deleting
   * it, for a registered entity whose rows can be deleted (a no-op silently
   * loses deletes across devices otherwise). A falsy syncId is ignored.
   */
  recordTombstone: (
    userId: string,
    entityType: string,
    syncId: string | null | undefined,
  ) => Promise<void>;
}

export interface PluginRegistry {
  provide: <T>(key: string, value: T) => void;
  consume: <T>(key: string) => T | undefined;
  revoke: (key: string, value?: unknown) => boolean;
}

export interface PluginServices {
  /**
   * `name` registers one of several providers of the same service, for a
   * service keyed by something the caller picks (sessions.live by session
   * type). It must be listed in the manifest's `provides[].names`.
   */
  provide: <T extends object>(
    service: string,
    implementation: T,
    options?: { name?: string },
  ) => void;
  /** `provider` picks a named provider; omitted, the unnamed one. */
  get: <T extends object>(
    service: string,
    options?: { userId?: string; provider?: string },
  ) => T;
  /** Names of the providers running now ("" for an unnamed one). */
  providers: (service: string) => string[];
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
  /** The client address, behind a trusted proxy when one is configured. */
  readonly clientIp: string;
  /** The public origin the request came in on, for browser redirects. */
  readonly requestOrigin: string;
  /**
   * Whether the user's data key is still unlocked. False for a guest and
   * once a session expires, so a long-lived socket can refuse work it can no
   * longer decrypt for.
   */
  isDataUnlocked: () => boolean;
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
  /**
   * With `public`, still resolves a token when the client sent one, so one
   * route can serve signed-in users and a guest arriving with a token of its
   * own. The handler gets the user id, or an empty one for a guest.
   */
  optionalAuth?: boolean;
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

/**
 * The plugin's own settings, as declared in contributes.settings.
 *
 * Reading and writing a plugin's own settings needs no capability: the
 * manifest already says which fields exist, and a plugin that could not read
 * its own configuration would be useless. Only readCore, which reaches outside
 * the plugin's namespace, is gated on settings:read-core.
 *
 * Values are validated against the declared field on every write, so a key the
 * manifest never declared is rejected rather than stored. Secret fields are
 * encrypted at rest and returned decrypted here; the HTTP surface never sends
 * them to a browser.
 */
export interface PluginSettings {
  /** Install-wide admin settings. */
  get: <T = unknown>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;

  /** Per-user settings. */
  getUser: <T = unknown>(userId: string, key: string) => Promise<T | undefined>;
  setUser: (userId: string, key: string, value: unknown) => Promise<void>;

  /** Per-host settings. */
  getHost: <T = unknown>(
    hostId: number | string,
    key: string,
  ) => Promise<T | undefined>;
  setHost: (
    hostId: number | string,
    key: string,
    value: unknown,
  ) => Promise<void>;

  /** Every value in one scope, with declared defaults merged in. */
  getAll: (
    scope: "admin" | "user" | "host",
    scopeId?: string | number,
  ) => Promise<Record<string, unknown>>;

  /**
   * Fires when a key in this plugin's settings changes, from either the ctx
   * API or the HTTP routes. Disposed automatically on deactivate.
   */
  onChange: (key: string, listener: (value: unknown) => void) => () => void;

  /**
   * Reads a core server setting from a small documented allowlist.
   * Requires the settings:read-core capability.
   */
  readCore: (key: string) => Promise<string | null>;
}

/** A host's non-secret fields, for listing, tag matching and display. */
export interface PluginHostSummary {
  id: number;
  userId: string;
  name: string | null;
  ip: string;
  port: number;
  username: string;
  /** Comma-separated, as ssh_data stores them. Split on "," to match tags. */
  tags: string | null;
  folder: string | null;
  authType: string;
}

/**
 * A host record wide enough for a plugin that creates or updates hosts on the
 * user's behalf (import, discovery, sync), decrypted for that user. Unlike
 * PluginHostSummary this carries the fields a plugin needs to set up a
 * connectable host, not just what a list view shows. Still no secret auth
 * material (password, key, vault tokens): a plugin that creates a host picks
 * an authType and, for "credential", a credentialId it does not need to see
 * the contents of.
 */
export interface PluginHostRecord {
  id: number;
  userId: string;
  name: string | null;
  ip: string;
  port: number;
  username: string;
  authType: string;
  credentialId?: number | null;
  overrideCredentialUsername?: boolean | null;
  connectionType?: string | null;
  tags: string | null;
  folder: string | null;
  jumpHosts?: unknown;
  enableSsh?: boolean | null;
  enableTerminal?: boolean | null;
  enableFileManager?: boolean | null;
  enableTunnel?: boolean | null;
  enableDocker?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

/**
 * Fields a plugin may set when creating a host it will own or manage. Fields
 * that belong to another plugin's host settings (enableRdp, rdpPort) are
 * handed to that plugin's host import normalizer, as on a bulk import.
 */
export type PluginHostCreateInput = Partial<
  Omit<PluginHostRecord, "id" | "userId">
> & {
  name: string;
  ip: string;
  port: number;
  username: string;
  authType: string;
};

/** Fields a plugin may change on a host it already created or was granted access to. */
export type PluginHostUpdateInput = Partial<
  Omit<PluginHostRecord, "id" | "userId">
>;

/** The same shape canAccessHost returns internally, without secrets. */
export interface PluginHostAccess {
  hasAccess: boolean;
  isOwner: boolean;
  isShared: boolean;
  permissionLevel?: "connect" | "view" | "edit" | "manage";
  expiresAt?: string | null;
}

export type PluginHostShareLevel = "connect" | "view" | "edit" | "manage";

export interface PluginShareTarget {
  type: "user" | "role";
  id: string | number;
}

export interface PluginHostShareResult {
  hostId: number;
  shared: boolean;
  reason?: string;
}

/** A user or role a plugin can offer as a share target. No secrets, no roles' permission lists. */
export interface PluginShareableUser {
  id: string;
  username: string;
}

export interface PluginShareableRole {
  id: number;
  name: string;
  displayName: string | null;
}

/**
 * Hosts the acting user can see, and the RBAC + sharing operations a plugin
 * needs to build a feature (like fleets) on top of hosts it does not own.
 *
 * list/get/checkAccess need hosts:read. share, and the user/role pickers a
 * share UI needs, need hosts:write: sharing changes who can reach a host,
 * which is a write on that host's access, even though the plugin owns
 * neither the host nor the grant.
 */
export interface PluginHosts {
  /** Every host the acting user owns or was shared, without secrets. */
  list: () => Promise<PluginHostSummary[]>;
  /** One host the acting user can see, or null if it does not exist or they cannot. */
  get: (hostId: number) => Promise<PluginHostSummary | null>;
  /** The same access rule ctx.ssh.connect enforces, but naming the level, not just yes/no. */
  checkAccess: (
    hostId: number,
    level: PluginHostShareLevel,
  ) => Promise<PluginHostAccess>;
  /**
   * Creates a host owned by the acting user, encrypted the same way the host
   * editor's own create route does it. Needs hosts:write. For a plugin that
   * imports or discovers hosts on the user's behalf (B5's proxmox discovery).
   */
  create: (host: PluginHostCreateInput) => Promise<PluginHostRecord>;
  /**
   * Updates a host the acting user owns. Refuses a host it does not own
   * (sharing a write onto someone else's host goes through share(), not
   * update()). Needs hosts:write.
   */
  update: (
    hostId: number,
    patch: PluginHostUpdateInput,
  ) => Promise<PluginHostRecord | null>;
  /**
   * Every host the acting user owns, decrypted and wide (PluginHostRecord,
   * not the narrow list() summary). For a plugin that scans its own hosts in
   * the background (auto-sync) and needs fields list() does not carry, such
   * as credentialId or jumpHosts. Needs hosts:write, matching create/update:
   * this is the same "full host detail" surface a create/update caller needs
   * to read back, not a wider read grant than hosts:read gives via list/get.
   */
  listOwned: () => Promise<PluginHostRecord[]>;
  /**
   * Grants access to a host the caller manages, snapshotting shared secrets
   * for each target the same way the host editor's own share action does.
   * Refuses a host the caller does not hold "manage" on.
   */
  share: (
    hostId: number,
    targets: PluginShareTarget[],
    permissionLevel: PluginHostShareLevel,
    durationHours?: number,
  ) => Promise<PluginHostShareResult>;
  /** Users the caller may pick as a share target, for building a picker UI. */
  listUsers: () => Promise<PluginShareableUser[]>;
  /** Non-system roles the caller may pick as a share target. */
  listRoles: () => Promise<PluginShareableRole[]>;
  /**
   * Marks a live session on a host, for the online indicator. Counted with
   * every other feature's sessions; call the returned function once when the
   * session ends. Needs hosts:read.
   */
  trackSession: (hostId: number) => () => void;
  /**
   * Adds a recent activity entry for the acting user, rate limited and
   * refused for a host they cannot reach, like the dashboard's own route.
   * Needs hosts:read.
   */
  recordActivity: (
    hostId: number,
    type: string,
    hostName: string,
  ) => Promise<void>;
  /**
   * Core's reachability status, the one behind the host list's status dot.
   * Needs hosts:read.
   */
  status: PluginHostStatusApi;
}

/** online: a login worked. reachable: the port answers. offline: it does not. */
export type PluginHostStatus = "online" | "reachable" | "offline";

export interface PluginHostStatusEntry {
  status: PluginHostStatus;
  lastChecked: string;
  reason?: "host_key_changed";
}

/**
 * Core checks every host with status checks on by opening a TCP connection to
 * it. A plugin that logs in to hosts tells core how that went, which is what
 * turns "reachable" into "online".
 */
export interface PluginHostStatusApi {
  /** The last known status, or null when core has not checked the host yet. */
  get: (hostId: number) => PluginHostStatusEntry | null;
  /** Checks the host now unless core checked it recently. */
  check: (hostId: number) => Promise<PluginHostStatusEntry | null>;
  /** Reports a login attempt. Not audited: pollers call it every sample. */
  reportLogin: (
    hostId: number,
    outcome: { ok: boolean; hostKeyChanged?: boolean },
  ) => void;
  /**
   * Tells core which port proves a host of this connection type is up, for
   * protocols whose port lives in the plugin's own host settings. Core falls
   * back to the host's port. Removed on deactivate.
   */
  registerPort: (
    connectionType: string,
    resolve: (
      hostId: number,
    ) => number | undefined | Promise<number | undefined>,
  ) => () => void;
}

/**
 * A host as the SSH pipeline reads it: resolved by core, with secrets filled
 * in for the acting user. Plugins get one from core and hand it back; they
 * should not build one from scratch.
 */
export interface PluginSshHost {
  id: number;
  ip: string;
  port: number;
  username: string;
  userId?: string | null;
  authType?: string | null;
  [key: string]: unknown;
}

/** Picks keepalive and timeout defaults. "plugin" is the generic one. */
export type PluginSshPurpose =
  | "plugin"
  | "docker"
  | "docker-console"
  | "metrics"
  | "proxmox"
  | "fleet"
  | "remote-desktop"
  | "tunnel"
  | "file-manager"
  | "file-transfer"
  | "terminal"
  | "tmux";

export type PluginSshAuthOutcome =
  | { status: "ready" }
  | {
      status: "interaction-required";
      /** Transports send "<interaction>_auth_required", e.g. "opkssh". */
      interaction: string;
      message: string;
      /** Extra boolean HTTP transports put in their 401 body. */
      flag?: string;
    }
  | {
      status: "error";
      code:
        | "missing-secret"
        | "invalid-key"
        | "passphrase-required"
        | "provider-missing"
        | "failed";
      message: string;
    }
  | {
      /** Try once more with these config changes. */
      status: "retry";
      patch: Record<string, unknown>;
      message: string;
    };

export type PluginSshBannerDecision =
  | {
      /** Hold the connect timeout open and wait for the out-of-band step. */
      action: "hold";
      timeoutMs: number;
      message: string;
      details?: Record<string, unknown>;
    }
  | {
      /** The out-of-band step finished; resume the normal connect timeout. */
      action: "release";
      details?: Record<string, unknown>;
    };

export interface PluginKeyboardInteractivePrompt {
  prompt: string;
  echo?: boolean;
}

export type PluginKeyboardInteractiveDecision =
  | { kind: "auto"; responses: string[] }
  | {
      kind: "warpgate";
      url: string | null;
      securityKey: string;
      instructions: string;
    }
  | { kind: "totp"; promptIndex: number }
  | { kind: "input"; promptIndex: number; isPush: boolean };

export type PluginSshPromptRequest =
  | { kind: "totp"; prompt: string; retry: boolean }
  | { kind: "input"; prompt: string; echo: boolean; isPush: boolean }
  | {
      kind: "warpgate";
      url: string | null;
      securityKey: string;
      instructions: string;
    };

/** Answers keyboard-interactive prompts. Resolve null to give up. */
export interface PluginSshPromptChannel {
  ask: (request: PluginSshPromptRequest) => Promise<string | null>;
}

export interface PluginSshConnectOptions {
  purpose?: PluginSshPurpose;
  /** Overall time to reach "ready". Defaults to 30s. */
  timeoutMs?: number;
  /** Without one, the stored password answers password prompts. */
  prompt?: PluginSshPromptChannel;
  /** Config fields to force, e.g. a longer readyTimeout. */
  overrides?: Record<string, unknown>;
  /**
   * An already-open stream to the host, such as a forwardOut channel through
   * another host. The transport step is skipped: no port knocking, proxy,
   * jump hosts or DNS lookup. Host key checks and auth still run.
   */
  sock?: unknown;
}

export interface PluginSshConnection<Client = unknown> {
  /** An ssh2 Client, already "ready". */
  client: Client;
  jumpClient: Client | null;
  /** The host as core resolved it: ip, port, username, name and the rest. */
  host: PluginSshHost;
  /** Ends the connection and its jump chain. Also runs on deactivate. */
  dispose: () => void;
}

/**
 * SSH through core's one connect pipeline: host resolution, auth providers,
 * jump hosts, proxies, host key checks, keepalive and port knocking.
 *
 * Every call needs ssh:connect and credentials:use, runs as the acting user
 * (or the host's owner for background work on a resolved host) and writes an
 * audit line per new connection. Connections still open on deactivate are
 * closed.
 */
export interface PluginSsh {
  connect: <Client = unknown>(
    host: number | PluginSshHost,
    options?: PluginSshConnectOptions,
  ) => Promise<PluginSshConnection<Client>>;

  /** Borrows a pooled connection. The pool key is `<pool>:<owner>:<address>`. */
  withConnection: <T, Client = unknown>(
    host: number | PluginSshHost,
    options: PluginSshConnectOptions & { pool: string },
    fn: (client: Client) => Promise<T>,
  ) => Promise<T>;

  /**
   * A ready client at the end of a jump host chain, each hop resolved and
   * authenticated through the pipeline. For forwarding to something that is
   * not an SSH server (an RDP port behind a bastion).
   */
  jumpChain: <Client = unknown>(
    jumpHosts: Array<{ hostId: number }>,
    options?: {
      /** Background work: resolve the hops as this host's owner. */
      forHost?: PluginSshHost;
    },
  ) => Promise<PluginSshConnection<Client>>;

  /** The pool key withConnection would use, for clearing it. */
  poolKey: (pool: string, host: PluginSshHost) => string;

  /**
   * Closes this plugin's pooled connections to a host, for when its details
   * changed. Only keys this plugin created are touched.
   */
  dropPooled: (pool: string, hostId: number) => void;

  /**
   * The host as the acting user may connect to it: RBAC, owner-key
   * decryption, shared-host overrides and external secret references
   * resolved, secrets included. By sync id when given, since a numeric id
   * only names a host on the database that issued it. Null when the host is
   * not on this server or the user cannot reach it.
   */
  resolveHost: (
    hostId: number,
    options?: { syncId?: string | null },
  ) => Promise<PluginSshHost | null>;

  /**
   * Lower level: fills an ssh2 config for a client the plugin drives itself,
   * for transports with their own prompt flow. Never connects.
   */
  prepare: (
    host: PluginSshHost,
    options: {
      purpose?: PluginSshPurpose;
      client: unknown;
      /** Server-side host id when it differs from host.id. */
      serverHostId?: number;
      log?: (level: "info" | "warning" | "error", message: string) => void;
      /** A person is at the keyboard, so providers may prompt. */
      interactive?: boolean;
      /**
       * The ws socket the host key verifier asks on when a key is new or has
       * changed. Without one a changed key is refused.
       */
      hostKeySocket?: unknown;
    },
  ) => Promise<PluginSshPrepared>;

  /** Lower level: port knocking, jump hosts or proxy; sets config.sock. */
  openTransport: (
    host: PluginSshHost,
    config: Record<string, unknown>,
    options?: {
      /** False when the caller already resolved DNS, or a jump host will. */
      resolveDns?: boolean;
      log?: (level: "info" | "warning" | "error", message: string) => void;
    },
  ) => Promise<{ jumpClient: unknown | null; via: string }>;

  /**
   * Starts the browser step behind an `<interaction>_auth_required` message.
   * The provider for the host's own auth type wins, else the first provider
   * that owns the interaction. Rejects with PluginSshInteractionError when
   * none can.
   */
  startInteraction: (
    interaction: string,
    request: {
      hostId: number;
      socket: unknown;
      requestOrigin: string;
      payload?: Record<string, unknown>;
    },
  ) => Promise<void>;

  /** Cancels a pending browser step on every provider that owns it. */
  cancelInteraction: (
    interaction: string,
    request: { hostId?: number; requestId?: string },
  ) => Promise<void>;

  /** What a keyboard-interactive round is. Pure; no capability needed. */
  classifyKeyboardInteractive: (
    round: {
      name: string;
      instructions: string;
      prompts: PluginKeyboardInteractivePrompt[];
    },
    host: PluginSshHost,
  ) => PluginKeyboardInteractiveDecision;

  /** Stored password for password prompts, empty for the rest. */
  autoResponses: (
    prompts: PluginKeyboardInteractivePrompt[],
    password: string | null | undefined,
  ) => string[];

  /** Whether an auth type carries a secret (drives "auth_required" flows). */
  requiresSecret: (authType: string) => boolean;

  /** Whether an auth type can connect unattended, for polling. */
  supportsBackground: (authType: string) => boolean;
}

/** What ctx.ssh.prepare built, plus the provider hooks bound to it. */
export interface PluginSshPrepared {
  config: Record<string, unknown>;
  outcome: PluginSshAuthOutcome;
  /** The auth type whose provider prepared it, null when none exists. */
  authType: string | null;
  /** The provider's banner hook, bound to this host and connection. */
  onBanner?: (banner: string) => PluginSshBannerDecision | undefined;
  /** The provider's auth failure hook, bound to this host and connection. */
  onAuthFailed?: (context: {
    error: Error;
    retries: number;
    canRetry: boolean;
    methodNotAvailable: boolean;
  }) => PluginSshAuthOutcome | undefined;
}

/** Thrown by ctx.ssh.startInteraction when no provider can start it. */
export class PluginSshInteractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginSshInteractionError";
  }
}

export interface PluginSshAuthEnv {
  /** The ssh2 Client about to connect; certificate auth patches it. */
  client: unknown;
  userId: string;
  hostId: number;
  purpose: string;
  interactive: boolean;
  log: (level: "info" | "warning" | "error", message: string) => void;
}

/**
 * An SSH auth type. Its `type` is what ssh_data.auth_type stores, and it must
 * be listed in the manifest's contributes.auth.sshAuthTypes.
 */
export interface PluginSshAuthProvider {
  type: string;
  labelKey: string;
  descriptionKey?: string;
  /** Host and credential editor fields, in the settings field schema. */
  fields?: PluginSettingsField[];
  /** Also offered as a stored credential type. */
  credentialType?: boolean;
  /** Needs a browser sign-in or a person at the keyboard. */
  needsUserInteraction?: boolean;
  /** Carries a secret, so a shared host needs one resolved per recipient. */
  requiresSecret?: boolean;
  /** Can connect unattended. Defaults to true. */
  supportsBackground?: boolean;
  /** Interaction name its outcomes use, for startInteraction routing. */
  interaction?: string;
  connectOptions?: (
    host: PluginSshHost,
    purpose: string,
  ) => Record<string, unknown>;
  /** Fills the ssh2 config for this host. Never connects. */
  prepare: (
    config: Record<string, unknown>,
    host: PluginSshHost,
    env: PluginSshAuthEnv,
  ) => Promise<PluginSshAuthOutcome>;
  /** Claims keyboard-interactive rounds for hosts of this type. */
  onKeyboardInteractive?: (
    round: {
      name: string;
      instructions: string;
      prompts: PluginKeyboardInteractivePrompt[];
    },
    host: PluginSshHost,
  ) => PluginKeyboardInteractiveDecision | null;
  /** Synchronous: decide on a retry before the socket closes. */
  onAuthFailed?: (
    host: PluginSshHost,
    env: PluginSshAuthEnv,
    context: {
      error: Error;
      retries: number;
      canRetry: boolean;
      methodNotAvailable: boolean;
    },
  ) => PluginSshAuthOutcome | undefined;
  /**
   * Claims an ssh2 "banner" event during the handshake, for a server that
   * holds the connection open pending an out-of-band step (Tailscale SSH
   * check mode). A transport that can show this sends `<type>_check_required`
   * / `<type>_check_completed` over its socket, with `details` merged in.
   * Return nothing to leave the banner unhandled.
   */
  onBanner?: (
    banner: string,
    host: PluginSshHost,
    env: PluginSshAuthEnv,
  ) => PluginSshBannerDecision | undefined;
  /** Starts the browser step behind an interaction-required outcome. */
  startInteraction?: (request: {
    userId: string;
    hostId: number;
    host: { name?: string | null; ip: string; username: string };
    socket: unknown;
    requestOrigin: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
  /** Cancels a pending browser step. */
  cancelInteraction?: (request: {
    userId: string;
    hostId?: number;
    requestId?: string;
  }) => void | Promise<void>;
}

/**
 * Who a login method says the user is. Core finds or provisions the user,
 * runs second factors and issues the session; a method never does.
 */
export type PluginVerifiedIdentity =
  | {
      kind: "user";
      userId: string;
      /** The method already proved a second factor (a verified passkey). */
      mfaSatisfied?: boolean;
      /** Password logins unlock the user's data key with it. */
      password?: string;
      /** Redirect methods: where the browser goes back to. */
      returnTo?: string;
      rememberMe?: boolean;
    }
  | {
      kind: "external";
      /** Stable provider id, e.g. an SSO provider row id. */
      provider: string;
      /** The provider's id for the user. At most 255 characters. */
      subject: string;
      email?: string | null;
      name?: string | null;
      groups?: string[];
      /** Provider says the user is an admin (admin group, LDAP group). */
      isAdmin?: boolean;
      /** Allowed-users list to check before provisioning or signing in. */
      allowedUsers?: string | null;
      mfaSatisfied?: boolean;
      /** Redirect methods: where the browser goes back to. */
      returnTo?: string;
      rememberMe?: boolean;
    };

/** Request shape a login method sees. Structural, like PluginRequestLike. */
export interface PluginLoginRequest {
  body: Record<string, unknown>;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
  ip?: string;
  [key: string]: unknown;
}

export interface PluginLoginInstance {
  /** Passed back to start/verify as instanceId, e.g. an SSO provider id. */
  id: string;
  label: string;
  enabled: boolean;
}

export interface PluginLoginMethod {
  id: string;
  labelKey: string;
  icon?: string;
  kind: "redirect" | "form";
  /**
   * True for a method that authenticates against something other than a
   * password or key this server holds: SSO, an external directory, a
   * federated identity provider. Governs whether the "ask for a second
   * factor after external logins" admin setting applies to it. Leave unset
   * for a local method (password, a passkey, a plugin's own local form).
   */
  external?: boolean;
  /** Enabled instances, shown on the login screen. No secrets. */
  describe?: () => Promise<PluginLoginInstance[]>;
  /** Redirect methods: where to send the browser. */
  start?: (
    request: PluginLoginRequest,
    instanceId: string | null,
  ) => Promise<{ redirectUrl: string }>;
  /** Redirect methods: the provider's callback. */
  callback?: (request: PluginLoginRequest) => Promise<PluginVerifiedIdentity>;
  /** Form methods: check what the user typed. */
  verify?: (
    request: PluginLoginRequest,
    instanceId: string | null,
  ) => Promise<PluginVerifiedIdentity>;
}

export interface PluginSecondFactor {
  id: string;
  labelKey: string;
  isEnrolled: (userId: string) => Promise<boolean>;
  /** Anything the client needs before the user answers. */
  challenge?: (userId: string) => Promise<unknown>;
  /**
   * True when the answer is right. Return an object to refuse with a specific
   * message, for example when the factor had to be reset.
   */
  verify: (
    userId: string,
    body: Record<string, unknown>,
  ) => Promise<boolean | { ok: false; error: string; code?: string }>;
  /** Removes the user's enrolment. Called by the admin reset. */
  reset?: (userId: string) => Promise<void>;
}

/**
 * Login methods, second factors and SSH auth types. Every register call needs
 * auth:provide and a matching contributes.auth entry, and is undone on
 * deactivate. Core owns sessions: a method returns an identity and core does
 * the rest.
 */
export interface PluginAuth {
  registerSshAuthProvider: (provider: PluginSshAuthProvider) => void;
  registerLoginMethod: (method: PluginLoginMethod) => void;
  registerSecondFactor: (factor: PluginSecondFactor) => void;
  /**
   * Marks a user as enrolled in one of this plugin's factors. Core keeps the
   * row even when the plugin is gone, so it can refuse the login instead of
   * skipping the factor.
   */
  recordEnrollment: (userId: string, factorId: string) => Promise<void>;
  removeEnrollment: (userId: string, factorId: string) => Promise<void>;
}

export interface PluginOpenIsolatedWindowRequest {
  /** http(s) only. Refused when it points anywhere else. */
  url: string;
  /** Isolated Electron session partition; a fresh one when omitted. */
  partition?: string;
  title?: string;
  /** Present an invalid TLS certificate on this window's own origin only. */
  ignoreCert?: boolean;
}

/**
 * Opens a desktop window outside the main renderer, for a target a plugin
 * does not want sharing Termix's own session (a tunnelled or direct web UI).
 * Electron only: rejects when the server is not running embedded in the
 * desktop app. Needs desktop:window.
 */
export interface PluginNativeRdpRequest {
  host: string;
  port?: number;
  username?: string;
  domain?: string;
}

export interface PluginDesktop {
  openIsolatedWindow: (
    request: PluginOpenIsolatedWindowRequest,
  ) => Promise<{ success: true }>;
  /**
   * Opens the operating system's own RDP client (mstsc on Windows) for a
   * host. The password is never passed; the client asks for it. Windows
   * desktop app only.
   */
  launchNativeRdp: (
    request: PluginNativeRdpRequest,
  ) => Promise<{ success: boolean; error?: string }>;
  /** Whether the server runs embedded in the desktop app, so the calls above can work. */
  available: () => boolean;
}

/** A host protocol whose credentials core keeps next to the host. */
export type PluginHostProtocol = "rdp" | "vnc" | "telnet";

/**
 * What a plugin needs to hand a host's protocol login to something core
 * does not run (guacd): the address and the plaintext credentials the acting
 * user is allowed to use. A shared recipient gets the owner's shared
 * snapshot or their own override, never the owner's raw secret.
 */
export interface PluginProtocolTarget {
  host: {
    id: number;
    name: string | null;
    ip: string;
    /** The host's SSH port, the old fallback when no protocol port is set. */
    port: number;
    ownerUserId: string;
    jumpHosts: Array<{ hostId: number }>;
  };
  /** True when the acting user is not the owner. */
  shared: boolean;
  auth: {
    /** "direct", "credential", or "none" when the user is asked at connect time. */
    authType: string;
    username: string;
    password: string;
    domain: string;
  };
}

/**
 * Plaintext host credentials, for a plugin that has to hand them to another
 * program. Needs credentials:read, and every call is audited.
 */
export interface PluginCredentials {
  /** Null when the host does not exist or the acting user cannot connect to it. */
  resolveHostProtocol: (
    hostId: number,
    protocol: PluginHostProtocol,
  ) => Promise<PluginProtocolTarget | null>;
}

/**
 * An audit line under an action name of the plugin's choosing (an SSH login),
 * for the acting user, next to the plugin_* line every privileged ctx call
 * already writes.
 */
export interface PluginAudit {
  record: (entry: {
    action: string;
    resourceType?: string;
    resourceId?: string;
    resourceName?: string;
    details?: string;
    success: boolean;
    errorMessage?: string;
  }) => Promise<void>;
}

/**
 * A generic capability check, for a privileged action that has no dedicated
 * ctx method to wrap it: a plugin bundling its own native dependency to touch
 * hardware (a serial port, a USB device) is the first caller. Core cannot
 * mediate that access the way it mediates ctx.ssh or ctx.db, so the
 * capability here is a declared, reviewable, audited statement of intent
 * rather than a technical gate, matching process:spawn.
 */
export interface PluginCapabilities {
  /** Whether this plugin currently holds `capability`. Not audited: for deciding whether to offer something, not for gating an action. */
  has: (capability: string) => Promise<boolean>;
  /** Throws PluginCapabilityError if this plugin does not hold `capability`. Audited like every guarded ctx method. */
  require: (capability: string) => Promise<void>;
}

/**
 * Timers owned by the plugin. Every timer is cleared on deactivate, a run that
 * throws is logged instead of crashing the server, and a repeating job never
 * overlaps itself: a tick that arrives while the last run is still going is
 * skipped. No capability needed.
 */
export interface PluginSchedule {
  /** Runs `fn` every `intervalMs`. Returns a function that stops it. */
  every: (
    intervalMs: number,
    fn: () => void | Promise<void>,
    options?: {
      /** Delays the first run by up to this much, so many timers spread out. */
      jitterMs?: number;
      /** Also run once straight away. */
      runNow?: boolean;
    },
  ) => () => void;
  /** Runs `fn` once after `delayMs`. Returns a function that cancels it. */
  after: (delayMs: number, fn: () => void | Promise<void>) => () => void;
}

export interface PluginContext {
  readonly pluginId: string;
  readonly manifest: PluginManifest;
  readonly log: PluginLogger;
  readonly events: PluginEvents;
  readonly kv: PluginKeyValue;
  readonly files: PluginFiles;
  readonly db: PluginDatabase;
  readonly sync: PluginSync;
  readonly registry: PluginRegistry;
  readonly services: PluginServices;
  readonly secrets: PluginSecrets;
  readonly http: PluginHttp;
  readonly ws: PluginWebSockets;
  readonly rbac: PluginRbac;
  readonly settings: PluginSettings;
  readonly disposables: PluginDisposables;
  /** A generic capability check, for privileged code no ctx method wraps. */
  readonly capabilities: PluginCapabilities;
  /** Hosts the actor can see, and host-sharing operations. Needs hosts:read / hosts:write. */
  readonly hosts: PluginHosts;
  /** SSH through core's connect pipeline. Needs ssh:connect and credentials:use. */
  readonly ssh: PluginSsh;
  /** Login methods, second factors and SSH auth types. Needs auth:provide. */
  readonly auth: PluginAuth;
  /** Opens Electron windows outside the main renderer. Needs desktop:window. */
  readonly desktop: PluginDesktop;
  /** Plaintext host protocol credentials. Needs credentials:read. */
  readonly credentials: PluginCredentials;
  /** Audit lines under the plugin's own action names. */
  readonly audit: PluginAudit;
  /** Timers that stop on deactivate. */
  readonly schedule: PluginSchedule;

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
export type {
  PluginSettingsField,
  PluginSettingsContribution,
  PluginSettingsScope,
} from "./manifest.js";
