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
import type { SyncEntityRegistration } from "./backend.js";

export interface FakeContextOptions {
  pluginId?: string;
  manifest?: Partial<PluginManifest>;
  /** Acting user returned by currentActor and used by asUser. */
  actor?: string;
  /** Seed for admin-scope ctx.settings. */
  settings?: Record<string, unknown>;
  /** Seed for the core settings ctx.settings.readCore can reach. */
  coreSettings?: Record<string, string>;
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
  /** WebSocket routes registered through ctx.ws, in order. */
  wsRoutes: Array<{ path: string; raw: boolean }>;
  /** Router options passed to ctx.http.router, in order. */
  httpRouters: Array<PluginRouterOptions | undefined>;
  /** Backing store behind ctx.settings, keyed "<scope>:<scopeId>:<key>". */
  settings: Map<string, unknown>;
  /** Core settings readable through ctx.settings.readCore. */
  coreSettings: Map<string, string>;
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
  const wsRoutes: Array<{ path: string; raw: boolean }> = [];
  const httpRouters: Array<PluginRouterOptions | undefined> = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const settings = new Map<string, unknown>();
  const coreSettings = new Map<string, string>(
    Object.entries(options.coreSettings ?? {}),
  );
  const settingsListeners = new Map<string, Set<(value: unknown) => void>>();
  let actor = options.actor;

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

    db: {
      // No engine behind this one. A test that needs real SQL should drive the
      // runtime rather than the double.
      define: async (definition) => {
        tables.push(definition);
        return undefined as never;
      },
      client: async () => {
        throw new Error("createFakeContext does not implement db.client");
      },
      refs: async () => {
        throw new Error("createFakeContext does not implement db.refs");
      },
    },

    sync: {
      registerEntity: (entity) => {
        syncEntities.push(entity);
      },
    },

    registry: {
      provide: () => {},
      consume: () => undefined,
      revoke: () => false,
    },

    services: {
      provide: () => {},
      get: () => {
        throw new Error("createFakeContext does not implement services.get");
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
        return undefined as never;
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
      // Passes everything through: a test asserting a permission gate should
      // drive PermissionManager, not this double.
      has: async () => true,
      hasFor: async () => true,
      require: () => ((_req, _res, next) => next()) as PluginMiddleware,
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
    wsRoutes,
    httpRouters,
    settings,
    coreSettings,
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
 * topic outside the plugin's own namespace, and settings:read-core on
 * ctx.settings.readCore. Reading a plugin's own settings is deliberately
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
  };

  return { ...base, ctx: gatedCtx, checked };
}

/**
 * A TermixApp double for frontend tests.
 *
 * A7 builds the real registration surface; until then this records what a
 * plugin's frontend entry registered, which is all a test can assert about a
 * loader that does not exist yet. Deliberately free of any render library so
 * a plugin only needs testing-library if its own tests render something.
 */
export interface FakeTermixApp {
  app: TermixApp;
  /** Cleanups the plugin handed to app.onDispose. */
  disposals: Array<() => void>;
}

export function renderWithApp(
  options: { pluginId?: string; manifest?: Partial<PluginManifest> } = {},
): FakeTermixApp {
  const pluginId = options.pluginId ?? "test-plugin";
  const disposals: Array<() => void> = [];

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

  const app: TermixApp = {
    pluginId,
    manifest,
    onDispose: (dispose) => disposals.push(dispose),
  };

  return { app, disposals };
}
