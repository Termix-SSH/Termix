/**
 * Test helpers for plugin authors.
 *
 * createMockCtx is the one to reach for: it enforces capabilities the way the
 * real runtime does. createFakeContext stays for tests that only need a
 * context-shaped object and do not care about the gates.
 *
 * The vitest config these run under comes from @termix/plugin-sdk/vitest-preset.
 */

import { PluginCapabilityError } from "./backend.js";
import type {
  PluginContext,
  PluginDisposables,
  PluginLogger,
} from "./backend.js";
import type { TermixApp } from "./frontend.js";
import type { PluginManifest } from "./manifest.js";
import type { PluginTableDefinition } from "./db.js";
import type { PluginMiddleware, PluginRouterOptions } from "./backend.js";
import type {
  PluginLoginMethod,
  PluginSecondFactor,
  PluginSshAuthProvider,
  PluginSshHost,
  PluginHostSummary,
  PluginHostRecord,
  PluginHostCreateInput,
  PluginHostUpdateInput,
  PluginHostAccess,
  PluginHostShareResult,
  PluginShareableUser,
  PluginShareableRole,
} from "./backend.js";
import type { SyncEntityRegistration } from "./backend.js";
import type { PluginDatabase } from "./backend.js";

export interface FakeContextOptions {
  pluginId?: string;
  manifest?: Partial<PluginManifest>;
  /** Acting user returned by currentActor and used by asUser. */
  actor?: string;
  /** Seed for admin-scope ctx.settings. */
  settings?: Record<string, unknown>;
  /** Seed for the core settings ctx.settings.readCore can reach. */
  coreSettings?: Record<string, string>;
  /** What ctx.ssh.connect and withConnection hand back as the client. */
  sshClient?: unknown;
  /** A real database behind ctx.db, usually createTestDb().database. */
  db?: PluginDatabase;
  /** What ctx.http.router returns, e.g. () => express.Router(). */
  router?: () => unknown;
  /**
   * Role permissions the acting user holds, as full ids or this plugin's
   * short names. When set, ctx.rbac enforces them and require() answers 403;
   * when omitted every check passes, so tests that do not care stay simple.
   */
  permissions?: string[];
  /** Hosts ctx.hosts.list/get/checkAccess answer with. */
  hosts?: PluginHostSummary[];
  /** Users and roles ctx.hosts.listUsers/listRoles answer with. */
  shareableUsers?: PluginShareableUser[];
  shareableRoles?: PluginShareableRole[];
}

export interface FakeAuthRegistrations {
  sshAuthProviders: PluginSshAuthProvider[];
  loginMethods: PluginLoginMethod[];
  secondFactors: PluginSecondFactor[];
  /** "<userId>:<factorId>" for every recorded enrolment. */
  enrollments: Set<string>;
}

export interface FakePluginContext {
  ctx: PluginContext;
  /** Everything the plugin registered through ctx.disposables. */
  disposals: Array<() => void | Promise<void>>;
  /** Topics emitted through ctx.events.emit, in order. */
  emitted: Array<{ topic: string; payload: unknown }>;
  /** Backing store behind ctx.kv. */
  kv: Map<string, unknown>;
  /** Table definitions registered through ctx.db.define, in order. */
  tables: PluginTableDefinition[];
  /** Sync entities registered through ctx.sync.registerEntity, in order. */
  syncEntities: SyncEntityRegistration[];
  /** Tombstones recorded through ctx.sync.recordTombstone, in order. */
  tombstones: Array<{ userId: string; entityType: string; syncId: string }>;
  /** WebSocket routes registered through ctx.ws, in order. */
  wsRoutes: Array<{ path: string; raw: boolean }>;
  /** Router options passed to ctx.http.router, in order. */
  httpRouters: Array<PluginRouterOptions | undefined>;
  /** Backing store behind ctx.settings, keyed "<scope>:<scopeId>:<key>". */
  settings: Map<string, unknown>;
  /** Core settings readable through ctx.settings.readCore. */
  coreSettings: Map<string, string>;
  /** Every ctx.ssh.connect and withConnection call, in order. */
  sshConnections: Array<{ host: number | PluginSshHost; pool?: string }>;
  /** Every ctx.hosts.share call, in order. */
  hostShares: Array<{
    hostId: number;
    targets: unknown[];
    permissionLevel: string;
    durationHours?: number;
  }>;
  /** Everything registered through ctx.auth. */
  auth: FakeAuthRegistrations;
  /** Changes the acting user, as core's request middleware would. */
  setActor: (userId: string | undefined) => void;
  /** Implementations provided through ctx.services.provide, by service name. */
  services: Map<string, object>;
}

const CORE_PERMISSION_GROUPS = new Set([
  "hosts",
  "snippets",
  "credentials",
  "admin",
]);

/**
 * A short name takes the plugin's prefix. An id already under this plugin or
 * a core group is used as given, like src/backend/plugins/rbac.ts does.
 */
function qualifyPermission(pluginId: string, permission: string): string {
  const head = permission.split(".")[0];
  if (head === pluginId || CORE_PERMISSION_GROUPS.has(head)) return permission;
  return `${pluginId}.${permission}`;
}

/** How a settings row is keyed in the doubles. Mirrors the real unique index. */
function settingsKey(
  scope: string,
  scopeId: string | number | undefined,
  key: string,
): string {
  return `${scope}:${scopeId ?? ""}:${key}`;
}

function noopLogger(): PluginLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

/**
 * A context double good enough to call activate() against in a unit test.
 * Nothing here is capability-checked: a test asserting a capability gate
 * should use the real runtime, not this.
 */
export function createFakeContext(
  options: FakeContextOptions = {},
): FakePluginContext {
  const pluginId = options.pluginId ?? "test-plugin";
  const disposals: Array<() => void | Promise<void>> = [];
  const emitted: Array<{ topic: string; payload: unknown }> = [];
  const kv = new Map<string, unknown>();
  const tables: PluginTableDefinition[] = [];
  const syncEntities: SyncEntityRegistration[] = [];
  const tombstones: Array<{
    userId: string;
    entityType: string;
    syncId: string;
  }> = [];
  const wsRoutes: Array<{ path: string; raw: boolean }> = [];
  const httpRouters: Array<PluginRouterOptions | undefined> = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const settings = new Map<string, unknown>();
  const coreSettings = new Map<string, string>(
    Object.entries(options.coreSettings ?? {}),
  );
  const settingsListeners = new Map<string, Set<(value: unknown) => void>>();
  const sshConnections: FakePluginContext["sshConnections"] = [];
  const hostShares: FakePluginContext["hostShares"] = [];
  const hostsById = new Map<number, PluginHostSummary>(
    (options.hosts ?? []).map((h) => [h.id, h]),
  );
  const hostRecordsById = new Map<number, PluginHostRecord>();
  let nextHostId = Math.max(0, ...(options.hosts ?? []).map((h) => h.id)) + 1;
  const services = new Map<string, object>();
  const auth: FakeAuthRegistrations = {
    sshAuthProviders: [],
    loginMethods: [],
    secondFactors: [],
    enrollments: new Set(),
  };
  const sshClient = options.sshClient ?? {};
  let actor = options.actor;
  const held = options.permissions
    ? new Set(
        options.permissions.map((permission) =>
          qualifyPermission(pluginId, permission),
        ),
      )
    : null;
  const holds = (permission: string) =>
    held === null || held.has(qualifyPermission(pluginId, permission));

  for (const [key, value] of Object.entries(options.settings ?? {})) {
    settings.set(settingsKey("admin", undefined, key), value);
  }

  const writeSetting = (
    scope: string,
    scopeId: string | number | undefined,
    key: string,
    value: unknown,
  ) => {
    settings.set(settingsKey(scope, scopeId, key), value);
    for (const listener of settingsListeners.get(key) ?? []) listener(value);
  };

  const manifest = {
    id: pluginId,
    name: pluginId,
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities: [],
    ...options.manifest,
  } as PluginManifest;

  const disposables: PluginDisposables = {
    add: (dispose) => disposals.push(dispose),
  };

  const ctx: PluginContext = {
    pluginId,
    manifest,
    log: noopLogger(),

    events: {
      emit: (topic, payload) => {
        emitted.push({ topic, payload });
        for (const listener of listeners.get(topic) ?? []) listener(payload);
      },
      on: (topic, listener) => {
        let set = listeners.get(topic);
        if (!set) {
          set = new Set();
          listeners.set(topic, set);
        }
        set.add(listener);
        return () => set!.delete(listener);
      },
    },

    kv: {
      get: async (key) => (kv.has(key) ? kv.get(key) : null),
      set: async (key, value) => {
        kv.set(key, value);
      },
      delete: async (key) => kv.delete(key),
      list: async () => [...kv.keys()],
    },

    db: options.db
      ? {
          ...options.db,
          define: async (definition) => {
            tables.push(definition);
            return options.db!.define(definition);
          },
          client: () => options.db!.client(),
          refs: () => options.db!.refs(),
          persist: () => options.db!.persist(),
          dialect: options.db.dialect,
        }
      : {
          // No engine behind this one. Pass createTestDb().database as `db`
          // for a test that needs real SQL.
          define: async (definition) => {
            tables.push(definition);
            return undefined as never;
          },
          client: async () => {
            throw new Error(
              "createFakeContext has no database: pass createTestDb().database as db",
            );
          },
          refs: async () => {
            throw new Error(
              "createFakeContext has no database: pass createTestDb().database as db",
            );
          },
          persist: async () => {},
          dialect: "sqlite",
        },

    sync: {
      registerEntity: (entity) => {
        syncEntities.push(entity);
      },
      recordTombstone: async (userId, entityType, syncId) => {
        if (!syncId) return;
        tombstones.push({ userId, entityType, syncId });
      },
    },

    registry: {
      provide: () => {},
      consume: () => undefined,
      revoke: () => false,
    },

    services: {
      provide: (service, implementation) => {
        services.set(service, implementation);
      },
      // Only services this same context provided. A test of a consumer
      // should provide a stub first.
      get: (service) => {
        const implementation = services.get(service);
        if (!implementation) {
          throw new Error(`No service "${service}" was provided in this test`);
        }
        return implementation as never;
      },
    },

    secrets: {
      offer: () => {},
      withdraw: () => false,
      getShared: async () => null,
    },

    http: {
      // No express here: a test that needs a real router should mount the
      // plugin's own route module against its own express app.
      router: (routerOptions) => {
        httpRouters.push(routerOptions);
        return (options.router ? options.router() : undefined) as never;
      },
    },

    ws: {
      route: (path) => {
        wsRoutes.push({ path, raw: false });
      },
      upgrade: (path) => {
        wsRoutes.push({ path, raw: true });
      },
    },

    rbac: {
      // Enforces options.permissions for the acting user, or passes
      // everything when none were given. The runtime's own resolution against
      // other plugins' namespaces is covered by core's tests, not here.
      has: async (permission) => holds(permission),
      hasFor: async (_userId, permission) => holds(permission),
      require: (permission) =>
        ((_req, res, next) => {
          if (holds(permission)) {
            next();
            return;
          }
          res.status(403).json({
            error: "Insufficient permissions",
            required: qualifyPermission(pluginId, permission),
          });
        }) as PluginMiddleware,
    },

    settings: {
      get: async (key) =>
        settings.get(settingsKey("admin", undefined, key)) as never,
      set: async (key, value) => writeSetting("admin", undefined, key, value),

      getUser: async (userId, key) =>
        settings.get(settingsKey("user", userId, key)) as never,
      setUser: async (userId, key, value) =>
        writeSetting("user", userId, key, value),

      getHost: async (hostId, key) =>
        settings.get(settingsKey("host", String(hostId), key)) as never,
      setHost: async (hostId, key, value) =>
        writeSetting("host", String(hostId), key, value),

      getAll: async (scope, scopeId) => {
        const prefix = `${scope}:${scopeId ?? ""}:`;
        const all: Record<string, unknown> = {};
        for (const [storedKey, value] of settings) {
          if (storedKey.startsWith(prefix)) {
            all[storedKey.slice(prefix.length)] = value;
          }
        }
        return all;
      },

      onChange: (key, listener) => {
        let set = settingsListeners.get(key);
        if (!set) {
          set = new Set();
          settingsListeners.set(key, set);
        }
        set.add(listener);
        const unsubscribe = () => {
          set!.delete(listener);
        };
        disposals.push(unsubscribe);
        return unsubscribe;
      },

      readCore: async (key) => coreSettings.get(key) ?? null,
    },

    disposables,

    hosts: {
      list: async () => [...hostsById.values()],
      get: async (hostId) => hostsById.get(hostId) ?? null,
      checkAccess: async (hostId): Promise<PluginHostAccess> => {
        const found = hostsById.get(hostId);
        if (!found)
          return { hasAccess: false, isOwner: false, isShared: false };
        const isOwner = found.userId === actor;
        return {
          hasAccess: true,
          isOwner,
          isShared: !isOwner,
          permissionLevel: "manage",
        };
      },
      create: async (
        host: PluginHostCreateInput,
      ): Promise<PluginHostRecord> => {
        const id = nextHostId++;
        const record: PluginHostRecord = {
          tags: null,
          folder: null,
          ...host,
          id,
          userId: actor ?? "unknown",
        };
        hostRecordsById.set(id, record);
        return record;
      },
      update: async (
        hostId: number,
        patch: PluginHostUpdateInput,
      ): Promise<PluginHostRecord | null> => {
        const existing = hostRecordsById.get(hostId);
        if (!existing) return null;
        const updated = { ...existing, ...patch };
        hostRecordsById.set(hostId, updated);
        return updated;
      },
      listOwned: async (): Promise<PluginHostRecord[]> => [
        ...hostRecordsById.values(),
      ],
      share: async (
        hostId,
        targets,
        permissionLevel,
        durationHours,
      ): Promise<PluginHostShareResult> => {
        hostShares.push({ hostId, targets, permissionLevel, durationHours });
        return { hostId, shared: true };
      },
      listUsers: async () => options.shareableUsers ?? [],
      listRoles: async () => options.shareableRoles ?? [],
    },

    ssh: {
      connect: async (host) => {
        sshConnections.push({ host });
        return {
          client: sshClient as never,
          jumpClient: null,
          host: (typeof host === "number"
            ? { id: host, ip: "", port: 22, username: "" }
            : host) as never,
          dispose: () => {},
        };
      },
      withConnection: async (host, connectOptions, fn) => {
        sshConnections.push({ host, pool: connectOptions.pool });
        return fn(sshClient as never);
      },
      jumpChain: async () => ({
        client: sshClient as never,
        jumpClient: null,
        host: { id: 0, ip: "", port: 22, username: "" } as never,
        dispose: () => {},
      }),
      poolKey: (pool, host) =>
        `${pool}:${host.userId}:${host.ip}:${host.port}:${host.username}`,
      prepare: async () => ({ config: {}, outcome: { status: "ready" } }),
      openTransport: async () => ({ jumpClient: null, via: "direct" }),
      classifyKeyboardInteractive: ({ prompts }, host) => ({
        kind: "auto",
        responses: prompts.map((p) =>
          /password/i.test(p.prompt) && typeof host.password === "string"
            ? host.password
            : "",
        ),
      }),
      autoResponses: (prompts, password) =>
        prompts.map((p) =>
          /password/i.test(p.prompt) && password ? password : "",
        ),
      requiresSecret: (authType) =>
        ["password", "key", "credential", "agent"].includes(authType),
      supportsBackground: (authType) =>
        !["none", "opkssh", "stepca"].includes(authType),
    },

    auth: {
      registerSshAuthProvider: (provider) => {
        auth.sshAuthProviders.push(provider);
      },
      registerLoginMethod: (method) => {
        auth.loginMethods.push(method);
      },
      registerSecondFactor: (factor) => {
        auth.secondFactors.push(factor);
      },
      recordEnrollment: async (userId, factorId) => {
        auth.enrollments.add(`${userId}:${factorId}`);
      },
      removeEnrollment: async (userId, factorId) => {
        auth.enrollments.delete(`${userId}:${factorId}`);
      },
    },

    asUser: async (userId, fn) => {
      const previous = actor;
      actor = userId;
      try {
        return await fn();
      } finally {
        actor = previous;
      }
    },

    currentActor: () => actor,
  };

  return {
    ctx,
    disposals,
    emitted,
    kv,
    tables,
    syncEntities,
    tombstones,
    wsRoutes,
    httpRouters,
    settings,
    coreSettings,
    sshConnections,
    hostShares,
    auth,
    setActor: (userId) => {
      actor = userId;
    },
    services,
  };
}

export interface MockContextOptions {
  pluginId?: string;
  manifest?: Partial<PluginManifest>;
  /** Capabilities the plugin is granted. Anything else throws. */
  capabilities?: string[];
  /** Seed for ctx.kv. */
  kv?: Record<string, unknown>;
  /** Seed for this plugin's own admin-scope settings. */
  settings?: Record<string, unknown>;
  /** Seed for the core settings readCore can reach. */
  coreSettings?: Record<string, string>;
  /** Acting user returned by currentActor and used by asUser. */
  actor?: string;
  /** What ctx.ssh.connect and withConnection hand back as the client. */
  sshClient?: unknown;
  /** A real database behind ctx.db, usually createTestDb().database. */
  db?: PluginDatabase;
  /** What ctx.http.router returns, e.g. () => express.Router(). */
  router?: () => unknown;
  /** Role permissions the acting user holds. See FakeContextOptions. */
  permissions?: string[];
}

export interface MockPluginContext extends FakePluginContext {
  /** Capability ids checked during the test, in order, denied ones included. */
  checked: string[];
}

/**
 * A context double that gates on capabilities the way src/backend/plugins/ctx.ts
 * does, so a test can prove a plugin fails closed without a running server.
 *
 * The gates on today's ctx surface: kv:own on every ctx.kv call, db:own on
 * ctx.db, network:serve on ctx.http and ctx.ws, events:core on emitting a
 * topic outside the plugin's own namespace, settings:read-core on
 * ctx.settings.readCore, ssh:connect plus credentials:use on ctx.ssh, and
 * auth:provide on ctx.auth. Reading a plugin's own settings is deliberately
 * ungated. As the SDK grows a member, add its gate here in the same shape.
 */
export function createMockCtx(
  options: MockContextOptions = {},
): MockPluginContext {
  const granted = new Set(options.capabilities ?? []);
  const checked: string[] = [];

  const base = createFakeContext({
    pluginId: options.pluginId,
    actor: options.actor,
    settings: options.settings,
    coreSettings: options.coreSettings,
    sshClient: options.sshClient,
    db: options.db,
    router: options.router,
    permissions: options.permissions,
    manifest: {
      capabilities: options.capabilities ?? [],
      ...options.manifest,
    },
  });

  const { ctx, kv } = base;
  const pluginId = ctx.pluginId;

  for (const [key, value] of Object.entries(options.kv ?? {})) {
    kv.set(key, value);
  }

  const require = (capability: string) => {
    checked.push(capability);
    if (!granted.has(capability)) {
      throw new PluginCapabilityError(pluginId, capability);
    }
  };

  const guardedKv = ctx.kv;
  const guardedDb = ctx.db;
  const gatedCtx: PluginContext = {
    ...ctx,

    db: {
      define: async (definition) => {
        require("db:own");
        return guardedDb.define(definition);
      },
      client: async () => {
        require("db:own");
        return guardedDb.client();
      },
      refs: async () => {
        require("db:own");
        return guardedDb.refs();
      },
      persist: async () => {
        require("db:own");
        return guardedDb.persist();
      },
      dialect: guardedDb.dialect,
    },

    kv: {
      get: async (key) => {
        require("kv:own");
        return guardedKv.get(key);
      },
      set: async (key, value) => {
        require("kv:own");
        return guardedKv.set(key, value);
      },
      delete: async (key) => {
        require("kv:own");
        return guardedKv.delete(key);
      },
      list: async () => {
        require("kv:own");
        return guardedKv.list();
      },
    },

    events: {
      emit: (topic, payload) => {
        if (
          !topic.startsWith(`plugin.${pluginId}.`) &&
          !granted.has("events:core")
        ) {
          throw new Error(
            `Plugin ${pluginId} may only emit topics under "plugin.${pluginId}.". ` +
              `Declare the events:core capability to emit core topics.`,
          );
        }
        ctx.events.emit(topic, payload);
      },
      on: (topic, listener) => ctx.events.on(topic, listener),
    },

    http: {
      router: (routerOptions) => {
        require("network:serve");
        return ctx.http.router(routerOptions);
      },
    },

    ws: {
      route: (path, handler, wsOptions) => {
        require("network:serve");
        ctx.ws.route(path, handler, wsOptions);
      },
      upgrade: (path, handler, wsOptions) => {
        require("network:serve");
        ctx.ws.upgrade(path, handler, wsOptions);
      },
    },

    settings: {
      // Reading and writing a plugin's OWN settings is ungated, exactly as in
      // the real runtime. Only readCore reaches outside the plugin.
      ...ctx.settings,
      readCore: async (key) => {
        require("settings:read-core");
        return ctx.settings.readCore(key);
      },
    },

    hosts: {
      list: async () => {
        require("hosts:read");
        return ctx.hosts.list();
      },
      get: async (hostId) => {
        require("hosts:read");
        return ctx.hosts.get(hostId);
      },
      checkAccess: async (hostId, level) => {
        require("hosts:read");
        return ctx.hosts.checkAccess(hostId, level);
      },
      create: async (host) => {
        require("hosts:write");
        return ctx.hosts.create(host);
      },
      update: async (hostId, patch) => {
        require("hosts:write");
        return ctx.hosts.update(hostId, patch);
      },
      listOwned: async () => {
        require("hosts:write");
        return ctx.hosts.listOwned();
      },
      share: async (hostId, targets, permissionLevel, durationHours) => {
        require("hosts:write");
        return ctx.hosts.share(hostId, targets, permissionLevel, durationHours);
      },
      listUsers: async () => {
        require("hosts:write");
        return ctx.hosts.listUsers();
      },
      listRoles: async () => {
        require("hosts:write");
        return ctx.hosts.listRoles();
      },
    },

    ssh: {
      ...ctx.ssh,
      connect: async (host, connectOptions) => {
        require("ssh:connect");
        require("credentials:use");
        return ctx.ssh.connect(host, connectOptions);
      },
      withConnection: async (host, connectOptions, fn) => {
        require("ssh:connect");
        require("credentials:use");
        return ctx.ssh.withConnection(host, connectOptions, fn);
      },
      prepare: async (host, prepareOptions) => {
        require("ssh:connect");
        require("credentials:use");
        return ctx.ssh.prepare(host, prepareOptions);
      },
      openTransport: async (host, config) => {
        require("ssh:connect");
        return ctx.ssh.openTransport(host, config);
      },
      jumpChain: async (jumpHosts, chainOptions) => {
        require("ssh:connect");
        require("credentials:use");
        return ctx.ssh.jumpChain(jumpHosts, chainOptions);
      },
    },

    auth: {
      registerSshAuthProvider: (provider) => {
        require("auth:provide");
        ctx.auth.registerSshAuthProvider(provider);
      },
      registerLoginMethod: (method) => {
        require("auth:provide");
        ctx.auth.registerLoginMethod(method);
      },
      registerSecondFactor: (factor) => {
        require("auth:provide");
        ctx.auth.registerSecondFactor(factor);
      },
      recordEnrollment: async (userId, factorId) => {
        require("auth:provide");
        return ctx.auth.recordEnrollment(userId, factorId);
      },
      removeEnrollment: async (userId, factorId) => {
        require("auth:provide");
        return ctx.auth.removeEnrollment(userId, factorId);
      },
    },
  };

  return { ...base, ctx: gatedCtx, checked };
}

/** A sqlite handle as createTestDb exposes it. Structural, like better-sqlite3's. */
export interface TestSqlite {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => unknown;
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  };
  close: () => void;
}

export interface TestDbOptions {
  /**
   * Runs after the core stub tables exist and before the plugin's migrations,
   * e.g. to create the legacy table an adoption migration renames.
   */
  before?: (sqlite: TestSqlite) => void | Promise<void>;
  /** Skip applying the migrations, to apply them by hand later. */
  skipMigrations?: boolean;
}

export interface TestDb {
  /** The raw better-sqlite3 handle, for asserting on tables directly. */
  sqlite: TestSqlite;
  /** The Drizzle handle ctx.db.client() returns. */
  drizzle: unknown;
  /** Pass this as createMockCtx({ db }). */
  database: PluginDatabase;
  /** How many times ctx.db.persist() was called. */
  readonly persisted: number;
  /** The migration ids applied, in order. */
  applied: string[];
  /** Applies the plugin's sqlite migrations, when skipMigrations was set. */
  migrate: () => Promise<string[]>;
  close: () => void;
}

/**
 * An in-memory SQLite database with a plugin's own migrations applied.
 *
 * Core's users, ssh_data, roles and user_roles exist as minimal stubs with
 * foreign keys on, so a refUser or refHost column cascades exactly as it
 * does on the server, and ctx.db.refs() has something real to join against.
 * The migrations are read from <pluginDir>/migrations/sqlite and split with
 * the same splitter the server's runner uses.
 */
export async function createTestDb(
  pluginDir: string,
  options: TestDbOptions = {},
): Promise<TestDb> {
  const [{ default: Database }, { drizzle }, fs, path, ddl, builder] =
    await Promise.all([
      import("better-sqlite3" as string),
      import("drizzle-orm/better-sqlite3" as string),
      import("node:fs"),
      import("node:path"),
      import("./ddl.js"),
      import("./table-builder.js"),
    ]);

  const sqlite = new Database(":memory:") as TestSqlite;
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(
    "CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL DEFAULT '')",
  );
  sqlite.exec("CREATE TABLE ssh_data (id INTEGER PRIMARY KEY AUTOINCREMENT)");
  sqlite.exec(
    "CREATE TABLE roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '')",
  );
  sqlite.exec(
    "CREATE TABLE user_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE)",
  );

  const handle = drizzle(sqlite);
  const pluginId = path.basename(pluginDir);
  const applied: string[] = [];
  let persisted = 0;

  await options.before?.(sqlite);

  const migrate = async () => {
    const dir = path.join(pluginDir, "migrations", "sqlite");
    if (!fs.existsSync(dir)) return [];
    const files = fs
      .readdirSync(dir)
      .filter((file: string) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
      .sort();
    const now: string[] = [];
    for (const file of files) {
      const id = file.replace(/\.sql$/, "");
      if (applied.includes(id)) continue;
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      for (const statement of ddl.splitStatements(source)) {
        sqlite.exec(statement);
      }
      applied.push(id);
      now.push(id);
    }
    return now;
  };

  if (!options.skipMigrations) await migrate();

  const refs = {
    users: builder.buildRefTable("users", { id: "text", username: "text" }),
    hosts: builder.buildRefTable("ssh_data", { id: "integer" }),
    roles: builder.buildRefTable("roles", {
      id: "integer",
      name: "text",
      displayName: "text",
    }),
    userRoles: builder.buildRefTable("user_roles", {
      id: "integer",
      userId: "text",
      roleId: "integer",
    }),
  };

  const database: PluginDatabase = {
    define: async (definition) =>
      builder.buildTable(pluginId, definition) as never,
    client: async () => handle as never,
    refs: async () => refs as never,
    persist: async () => {
      persisted += 1;
    },
    dialect: "sqlite",
  };

  return {
    sqlite,
    drizzle: handle,
    database,
    get persisted() {
      return persisted;
    },
    applied,
    migrate,
    close: () => sqlite.close(),
  };
}

/**
 * Rendering a plugin frontend in a test.
 *
 * renderWithApp activates the plugin against the real registration surface,
 * so a test sees exactly what the shell would: which rail items, tabs, host
 * actions and cards it registered, and each of those rendered with the SDK
 * hooks working. It is implemented by the Termix host, which is where the
 * registries live; the vitest preset points "@termix/plugin-host/testing" at
 * core's implementation.
 */
export interface RenderWithAppOptions {
  pluginId?: string;
  manifest?: Partial<PluginManifest>;
  /** Role permissions the current user holds. */
  permissions?: string[];
  isAdmin?: boolean;
  /** Hosts useHosts() returns. */
  hosts?: Array<Record<string, unknown>>;
  /** The plugin's locales/en.json, loaded into its namespace. */
  locales?: Record<string, unknown>;
  /** Render as an anonymous guest page. */
  guest?: boolean;
  /** What app.tabs.getLayout returns until the plugin applies another. */
  layout?: import("./frontend.js").ShellLayout;
  /** Fire app.tabs.onReady after activation, as the shell does after login. */
  ready?: boolean;
  /** Stands in for app.api and usePluginApi(), e.g. a stub of the routes. */
  api?: import("./frontend.js").PluginApiClient;
}

/** A call a plugin made on the shell, recorded instead of performed. */
export interface ShellCall {
  method: string;
  args: unknown[];
}

export interface RenderedPluginApp {
  app: TermixApp;
  /** Everything this plugin registered, by kind. */
  registered: {
    railItems: () => Array<{
      id: string;
      hidden?: boolean;
      /** The full permission id the item is gated on, if any. */
      permission?: string;
    }>;
    tabs: () => string[];
    panels: () => string[];
    hostActions: () => Array<{ id: string; tabType?: string }>;
    hostEditorSections: () => string[];
    dashboardCards: () => string[];
    settingsComponents: () => string[];
    slot: (slotId: string) => string[];
    actions: () => string[];
  };
  /** Shell calls made by the plugin's code, applyLayout included. */
  shellCalls: ShellCall[];
  /**
   * Tabs the last app.tabs.applyLayout opened, under the shell's own restore
   * rules: a tab whose host is gone is skipped, a tab no running plugin
   * registered is kept.
   */
  openedTabs: () => Array<{ type: string; hostId?: number; label: string }>;
  /**
   * Renders an opened tab the way the shell would, which for a tab no running
   * plugin registered is the "needs the plugin" placeholder.
   */
  renderOpenedTab: (index: number) => HTMLElement;
  renderTab: (type: string, props?: Record<string, unknown>) => HTMLElement;
  renderPanel: (id: string, props?: Record<string, unknown>) => HTMLElement;
  renderDashboardCard: (id: string) => HTMLElement;
  renderHostEditorSection: (
    id: string,
    props?: Record<string, unknown>,
  ) => HTMLElement;
  renderSettingsComponent: (
    componentId: string,
    props?: Record<string, unknown>,
  ) => HTMLElement;
  /** Renders a slot the way its owner would. */
  renderSlot: (slotId: string, props?: Record<string, unknown>) => HTMLElement;
  /** Runs deactivate and every disposer, as disabling the plugin does. */
  deactivate: () => Promise<void>;
}

export type FrontendPluginModule = {
  activate: (app: TermixApp) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
};

interface PluginTestHost {
  renderPlugin: (
    plugin: FrontendPluginModule,
    options: RenderWithAppOptions,
  ) => Promise<RenderedPluginApp>;
}

const TEST_HOST = "@termix/plugin-host/testing";

export async function renderWithApp(
  plugin: FrontendPluginModule,
  options: RenderWithAppOptions = {},
): Promise<RenderedPluginApp> {
  // A variable specifier keeps bundlers from resolving it at build time; the
  // test runner resolves it through its alias.
  const host = (await import(/* @vite-ignore */ TEST_HOST)) as PluginTestHost;
  return host.renderPlugin(plugin, options);
}
