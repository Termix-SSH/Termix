/**
 * Test helpers for plugin authors.
 *
 * createMockCtx is the one to reach for: it enforces capabilities the way the
 * real runtime does. createFakeContext stays for tests that only need a
 * context-shaped object and do not care about the gates.
 *
 * The vitest config these run under comes from @termix/plugin-sdk/vitest-preset.
 */

import { LoginMethodError, PluginCapabilityError } from "./backend.js";
import type {
  PluginContext,
  PluginDisposables,
  PluginLogger,
} from "./backend.js";
import type { TermixApp } from "./frontend.js";
import type { PluginManifest } from "./manifest.js";
import type { PluginTableDefinition } from "./db.js";
import type {
  PluginMiddleware,
  PluginRouterOptions,
  PluginWebSocketHandler,
  PluginWebSockets,
  PluginWebSocketOptions,
} from "./backend.js";

/** The bits of an express Response the fake completeRedirectLogin uses. */
interface FakeResponse {
  status: (code: number) => FakeResponse;
  json: (body: unknown) => unknown;
  redirect: (url: string) => unknown;
}

/** A ctx.ws registration as the test doubles record it. */
export interface FakeWsRoute {
  path: string;
  raw: boolean;
  /** For ctx.ws.route. */
  handler?: PluginWebSocketHandler;
  /** For ctx.ws.upgrade. */
  upgrade?: Parameters<PluginWebSockets["upgrade"]>[1];
  options?: PluginWebSocketOptions;
}
import type {
  PluginLoginMethod,
  PluginLoginRequest,
  PluginVerifiedIdentity,
  PluginSecondFactor,
  PluginSshAuthProvider,
  PluginSshConnectOptions,
  PluginSshHost,
  PluginHostSummary,
  PluginHostRecord,
  PluginHostCreateInput,
  PluginHostUpdateInput,
  PluginHostAccess,
  PluginHostShareResult,
  PluginShareableUser,
  PluginShareableRole,
  PluginSshKeyCredential,
  PluginSshKeyCredentialInput,
} from "./backend.js";
import type { SyncEntityRegistration } from "./backend.js";
import type { PluginDatabase } from "./backend.js";
import type {
  PluginNativeRdpRequest,
  PluginProtocolTarget,
  PluginHostStatusEntry,
  PluginNotification,
  PluginNotificationChannel,
  PluginFetchInit,
  PluginBinarySpec,
  PluginTlsCertificateInfo,
  PluginTlsStatus,
  PluginKeyboardInteractiveHandler,
  PluginProcessHandle,
  PluginProcessOptions,
} from "./backend.js";

/** A timer registered through ctx.schedule, run by hand with runScheduled. */
export interface FakeScheduledJob {
  kind: "every" | "after";
  ms: number;
  fn: () => void | Promise<void>;
  stopped: boolean;
}

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
  /**
   * Services other plugins provide, for testing a consumer. Keyed by service
   * name, or "<service>#<provider>" for a named provider.
   */
  services?: Record<string, object>;
  /** Hosts ctx.hosts.list/get/checkAccess answer with. */
  hosts?: PluginHostSummary[];
  /** Users and roles ctx.hosts.listUsers/listRoles answer with. */
  shareableUsers?: PluginShareableUser[];
  shareableRoles?: PluginShareableRole[];
  /** Hosts ctx.ssh.resolveHost answers with, secrets included. */
  sshHosts?: PluginSshHost[];
  /**
   * What ctx.credentials.resolveHostProtocol answers, keyed
   * "<hostId>:<protocol>". A missing key answers null.
   */
  protocolTargets?: Record<string, PluginProtocolTarget>;
  /** What ctx.credentials.listSshKeys answers. */
  sshKeyCredentials?: PluginSshKeyCredential[];
  /** What ctx.desktop.available() answers. Defaults to false. */
  desktopAvailable?: boolean;
  /** What ctx.hosts.status.get and check answer, by host id. */
  hostStatuses?: Record<number, PluginHostStatusEntry>;
  /** The acting user's channels, what ctx.notify.channels answers. */
  notificationChannels?: PluginNotificationChannel[];
  /**
   * Answers ctx.fetch. Without it every fetch rejects, so a test never
   * reaches the network by accident.
   */
  fetch?: (url: string, init?: PluginFetchInit) => Promise<Response>;
  /**
   * Answers ctx.process. Without run every ctx.process.run rejects; without
   * ensureBinary it answers "/tmp/<pluginId>/bin/<name>".
   */
  process?: FakeProcessOptions;
  /**
   * What ctx.system.tlsStatus answers before any write. renewal is filled in
   * from registerTlsRenewer calls.
   */
  tlsStatus?: Omit<PluginTlsStatus, "renewal">;
  /**
   * Checks a ctx.system.writeTlsCertificate call. Throw to reject the pair.
   * Without it every pair is accepted and described with placeholder info.
   */
  validateTls?: (
    certificatePem: string,
    privateKeyPem: string,
  ) => PluginTlsCertificateInfo;
  /**
   * Makes ctx.auth.recordEnrollment refuse the way core's policy does (trusted
   * proxy login on, password login off), with this message and a 409.
   */
  refuseEnrollment?: string;
  /** What ctx.http.baseUrl answers. Defaults to "https://termix.test". */
  baseUrl?: string;
  /** What ctx.auth.countLinkedUsers answers, by provider. Defaults to 0. */
  linkedUsers?: Record<string, number>;
  /** Failures before ctx.auth.loginRateLimit locks a key. Defaults to 5. */
  loginAttemptLimit?: number;
}

export interface FakeProcessOptions {
  run?: (
    file: string,
    args: readonly string[],
    options?: PluginProcessOptions,
  ) => PluginProcessHandle | Promise<PluginProcessHandle>;
  ensureBinary?: (spec: PluginBinarySpec) => Promise<string>;
}

/** A ctx.process handle a test drives by hand. */
export interface FakeProcess extends PluginProcessHandle {
  emitStdout: (chunk: string) => void;
  emitStderr: (chunk: string) => void;
  exit: (code: number | null, signal?: string | null) => void;
  killed: string[];
}

export function createFakeProcess(pid = 4242): FakeProcess {
  const stdout: Array<(chunk: string) => void> = [];
  const stderr: Array<(chunk: string) => void> = [];
  const killed: string[] = [];
  let resolveExit: (value: {
    code: number | null;
    signal: string | null;
  }) => void = () => {};
  const exited = new Promise<{ code: number | null; signal: string | null }>(
    (resolve) => {
      resolveExit = resolve;
    },
  );
  return {
    pid,
    onStdout: (listener) => void stdout.push(listener),
    onStderr: (listener) => void stderr.push(listener),
    exited,
    kill: (signal = "SIGTERM") => {
      killed.push(signal);
      resolveExit({ code: null, signal });
    },
    emitStdout: (chunk) => stdout.forEach((listener) => listener(chunk)),
    emitStderr: (chunk) => stderr.forEach((listener) => listener(chunk)),
    exit: (code, signal = null) => resolveExit({ code, signal }),
    killed,
  };
}

export interface FakeAuthRegistrations {
  sshAuthProviders: PluginSshAuthProvider[];
  keyboardInteractiveHandlers: PluginKeyboardInteractiveHandler[];
  loginMethods: PluginLoginMethod[];
  secondFactors: PluginSecondFactor[];
  /** "<userId>:<factorId>" for every recorded enrolment. */
  enrollments: Set<string>;
  /** Secret schemes registered through ctx.credentials.registerSecretResolver. */
  secretResolvers: Map<
    string,
    (userId: string, reference: string) => Promise<string>
  >;
  /** Identities handed to ctx.auth.completeRedirectLogin, in order. */
  completedLogins: Array<{
    methodId: string;
    identity: PluginVerifiedIdentity;
  }>;
  /** Every ctx.auth.revokeSessions call, in order. */
  revokedSessions: Array<{
    providerId?: number | null;
    sub?: string | null;
    sid?: string | null;
  }>;
  /** Failures recorded through ctx.auth.loginRateLimit, by "<ip>|<key>". */
  loginFailures: Map<string, number>;
}

export interface FakePluginContext {
  ctx: PluginContext;
  /** Runs what ctx.settings.onValidate registered, as a settings save would. */
  validateSettings: (
    scope: "admin" | "user" | "host",
    values: Record<string, unknown>,
    context?: { hostId?: number },
  ) => Promise<Record<string, string>>;
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
  /**
   * WebSocket routes registered through ctx.ws, in order, with the handler
   * and options, so a test can hand a route a fake socket.
   */
  wsRoutes: FakeWsRoute[];
  /** Router options passed to ctx.http.router, in order. */
  httpRouters: Array<PluginRouterOptions | undefined>;
  /** Backing store behind ctx.settings, keyed "<scope>:<scopeId>:<key>". */
  settings: Map<string, unknown>;
  /** Core settings readable through ctx.settings.readCore. */
  coreSettings: Map<string, string>;
  /** Every ctx.ssh.connect and withConnection call, in order. */
  sshConnections: Array<{
    host: number | PluginSshHost;
    pool?: string;
    options?: PluginSshConnectOptions;
  }>;
  /** Every ctx.hosts.share call, in order. */
  hostShares: Array<{
    hostId: number;
    targets: unknown[];
    permissionLevel: string;
    durationHours?: number;
  }>;
  /** Everything registered through ctx.auth. */
  auth: FakeAuthRegistrations;
  /** Every ctx.desktop.openIsolatedWindow call, in order. */
  desktopWindows: Array<{
    url: string;
    partition?: string;
    title?: string;
    ignoreCert?: boolean;
  }>;
  /** Every ctx.desktop.launchNativeRdp call, in order. */
  nativeRdpLaunches: PluginNativeRdpRequest[];
  /** Every ctx.credentials.resolveHostProtocol call, in order. */
  credentialReads: Array<{ hostId: number; protocol: string }>;
  /** Every ctx.credentials.createSshKey call, with the id it answered. */
  createdSshKeys: Array<PluginSshKeyCredentialInput & { id: number }>;
  /** Every ctx.notify.send call, with the actor it ran as. */
  notifications: Array<{
    actor: string | undefined;
    channelIds: number[];
    notification: PluginNotification;
  }>;
  /** Backing store behind ctx.secrets.get/set, keyed "<userId>:<key>". */
  secretStore: Map<string, string>;
  /** Every ctx.fetch call, in order. */
  fetches: Array<{ url: string; init?: PluginFetchInit }>;
  /** Every ctx.process.run call, in order. */
  processRuns: Array<{
    file: string;
    args: readonly string[];
    options?: PluginProcessOptions;
  }>;
  /** Every ctx.process.ensureBinary call, in order. */
  binaries: PluginBinarySpec[];
  /** What ctx.system did: accepted writes, reloads, live challenges and renewers. */
  tls: {
    writes: Array<{ certificatePem: string; privateKeyPem: string }>;
    reloads: number;
    /** ctx.system calls by name, in order. */
    calls: string[];
    challenges: Map<string, string>;
    renewers: number;
  };
  /** Every ctx.audit.record entry, in order. */
  audits: Array<{ action: string; success: boolean; [key: string]: unknown }>;
  /** Every ctx.hosts.recordActivity call, in order. */
  activities: Array<{ hostId: number; type: string; hostName: string }>;
  /** Host ids with a live ctx.hosts.trackSession, one entry per session. */
  trackedSessions: number[];
  /** Every ctx.ssh.startInteraction / cancelInteraction call, in order. */
  interactions: Array<{
    action: "start" | "cancel";
    interaction: string;
    request: Record<string, unknown>;
  }>;
  /** Every ctx.hosts.status.reportLogin call, in order. */
  statusReports: Array<{
    hostId: number;
    ok: boolean;
    hostKeyChanged?: boolean;
  }>;
  /** ctx.hosts.status.registerPort resolvers, by connection type. */
  statusPorts: Map<string, (hostId: number) => unknown>;
  /** Backing store behind ctx.hosts.status.get and check. */
  hostStatuses: Map<number, PluginHostStatusEntry>;
  /** Every ctx.ssh.dropPooled call, in order. */
  droppedPools: Array<{ pool: string; hostId: number }>;
  /** Every ctx.schedule timer, stopped ones included. */
  scheduled: FakeScheduledJob[];
  /** Runs every live ctx.schedule job once; "after" jobs are then done. */
  runScheduled: () => Promise<void>;
  /** Changes the acting user, as core's request middleware would. */
  setActor: (userId: string | undefined) => void;
  /** Provided or seeded services, by name or "<service>#<provider>". */
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
  const wsRoutes: FakeWsRoute[] = [];
  const httpRouters: Array<PluginRouterOptions | undefined> = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const settings = new Map<string, unknown>();
  const coreSettings = new Map<string, string>(
    Object.entries(options.coreSettings ?? {}),
  );
  const settingsListeners = new Map<string, Set<(value: unknown) => void>>();
  const settingsValidators = new Set<{
    scope: "admin" | "user" | "host";
    validator: Parameters<PluginContext["settings"]["onValidate"]>[1];
  }>();
  const sshConnections: FakePluginContext["sshConnections"] = [];
  const hostShares: FakePluginContext["hostShares"] = [];
  const desktopWindows: FakePluginContext["desktopWindows"] = [];
  const nativeRdpLaunches: FakePluginContext["nativeRdpLaunches"] = [];
  const credentialReads: FakePluginContext["credentialReads"] = [];
  const createdSshKeys: FakePluginContext["createdSshKeys"] = [];
  const notifications: FakePluginContext["notifications"] = [];
  const fetches: FakePluginContext["fetches"] = [];
  const processRuns: FakePluginContext["processRuns"] = [];
  const binaries: FakePluginContext["binaries"] = [];
  const tls: FakePluginContext["tls"] = {
    writes: [],
    reloads: 0,
    calls: [],
    challenges: new Map(),
    renewers: 0,
  };
  let tlsState: Omit<PluginTlsStatus, "renewal"> = options.tlsStatus ?? {
    enabled: true,
    certificate: null,
  };
  const secretStore = new Map<string, string>();
  const audits: FakePluginContext["audits"] = [];
  const activities: FakePluginContext["activities"] = [];
  const trackedSessions: number[] = [];
  const interactions: FakePluginContext["interactions"] = [];
  const statusReports: FakePluginContext["statusReports"] = [];
  const statusPorts: FakePluginContext["statusPorts"] = new Map();
  const hostStatuses = new Map<number, PluginHostStatusEntry>(
    Object.entries(options.hostStatuses ?? {}).map(([id, entry]) => [
      Number(id),
      entry,
    ]),
  );
  const droppedPools: FakePluginContext["droppedPools"] = [];
  const scheduled: FakeScheduledJob[] = [];
  const schedule = (
    kind: FakeScheduledJob["kind"],
    ms: number,
    fn: FakeScheduledJob["fn"],
  ) => {
    const job: FakeScheduledJob = { kind, ms, fn, stopped: false };
    scheduled.push(job);
    const stop = () => {
      job.stopped = true;
    };
    disposals.push(stop);
    return stop;
  };
  const hostsById = new Map<number, PluginHostSummary>(
    (options.hosts ?? []).map((h) => [h.id, h]),
  );
  const hostRecordsById = new Map<number, PluginHostRecord>();
  let nextHostId = Math.max(0, ...(options.hosts ?? []).map((h) => h.id)) + 1;
  const services = new Map<string, object>(
    Object.entries(options.services ?? {}),
  );
  const serviceKey = (service: string, name?: string) =>
    name ? `${service}#${name}` : service;
  const registryProviders = new Map<string, unknown>();
  const auth: FakeAuthRegistrations = {
    sshAuthProviders: [],
    keyboardInteractiveHandlers: [],
    loginMethods: [],
    secondFactors: [],
    enrollments: new Set(),
    secretResolvers: new Map(),
    completedLogins: [],
    revokedSessions: [],
    loginFailures: new Map(),
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
  // Like the runtime, a route can only require a permission the manifest
  // declares. Checked when the test hands in a manifest.
  const declaredPermissions = options.manifest?.contributes?.permissions
    ? new Set(
        options.manifest.contributes.permissions.map((entry) =>
          qualifyPermission(pluginId, entry.name),
        ),
      )
    : null;

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

    files: {
      // A fake path; a test that needs a real folder uses the OS temp dir
      // itself, not this double.
      dataDir: async () => `/tmp/${pluginId}`,
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
      provide: (key, value) => {
        registryProviders.set(key, value);
      },
      consume: (key) => registryProviders.get(key) as never,
      revoke: (key, value) => {
        if (!registryProviders.has(key)) return false;
        if (value !== undefined && registryProviders.get(key) !== value) {
          return false;
        }
        return registryProviders.delete(key);
      },
    },

    services: {
      provide: (service, implementation, provideOptions) => {
        services.set(serviceKey(service, provideOptions?.name), implementation);
      },
      // What this context provided or the test seeded through `services`.
      // Like the real handle, a missing provider is an empty object, which a
      // consumer's `"method" in handle` probe reads as absent.
      get: (service, getOptions) =>
        (services.get(serviceKey(service, getOptions?.provider)) ??
          {}) as never,
      providers: (service) =>
        [...services.keys()].flatMap((key) =>
          key === service
            ? [""]
            : key.startsWith(`${service}#`)
              ? [key.slice(service.length + 1)]
              : [],
        ),
    },

    secrets: {
      get: async (key) => secretStore.get(`${actor ?? ""}:${key}`) ?? null,
      set: async (key, value) => {
        if (value === null) secretStore.delete(`${actor ?? ""}:${key}`);
        else secretStore.set(`${actor ?? ""}:${key}`, value);
      },
      delete: async (key) => {
        secretStore.delete(`${actor ?? ""}:${key}`);
      },
      seal: async (value) =>
        `sealed:${Buffer.from(value, "utf8").toString("base64")}`,
      unseal: async (sealed) =>
        sealed?.startsWith("sealed:")
          ? Buffer.from(sealed.slice(7), "base64").toString("utf8")
          : null,
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
      baseUrl: () => options.baseUrl ?? "https://termix.test",
    },

    ws: {
      route: (path, handler, wsOptions) => {
        wsRoutes.push({ path, raw: false, handler, options: wsOptions });
      },
      upgrade: (path, handler, wsOptions) => {
        wsRoutes.push({
          path,
          raw: true,
          upgrade: handler,
          options: wsOptions,
        });
      },
    },

    rbac: {
      // Enforces options.permissions for the acting user, or passes
      // everything when none were given. The runtime's own resolution against
      // other plugins' namespaces is covered by core's tests, not here.
      has: async (permission) => holds(permission),
      hasFor: async (_userId, permission) => holds(permission),
      require: (permission) => {
        if (
          declaredPermissions &&
          !declaredPermissions.has(qualifyPermission(pluginId, permission))
        ) {
          throw new Error(
            `Plugin ${pluginId} cannot require permission "${permission}": it is not declared in contributes.permissions`,
          );
        }
        return ((_req, res, next) => {
          if (holds(permission)) {
            next();
            return;
          }
          res.status(403).json({
            error: "Insufficient permissions",
            required: qualifyPermission(pluginId, permission),
          });
        }) as PluginMiddleware;
      },
    },

    // Nothing here is capability-checked, per the module doc; createMockCtx
    // gates this against options.capabilities.
    capabilities: {
      has: async () => true,
      require: async () => {},
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

      listHostValues: async (key) => {
        const found: Array<{ hostId: number; userId: string; value: never }> =
          [];
        for (const [storedKey, value] of settings) {
          const [scope, scopeId, name] = storedKey.split(":");
          if (scope !== "host" || name !== key || value === undefined) continue;
          const hostId = Number(scopeId);
          found.push({
            hostId,
            userId: hostRecordsById.get(hostId)?.userId ?? actor ?? "",
            value: value as never,
          });
        }
        return found;
      },

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

      onValidate: (scope, validator) => {
        const entry = { scope, validator };
        settingsValidators.add(entry);
        const unsubscribe = () => {
          settingsValidators.delete(entry);
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
      delete: async (hostId: number): Promise<boolean> => {
        const existed =
          hostRecordsById.delete(hostId) || hostsById.delete(hostId);
        return existed;
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
      trackSession: (hostId) => {
        trackedSessions.push(hostId);
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          const index = trackedSessions.indexOf(hostId);
          if (index >= 0) trackedSessions.splice(index, 1);
        };
      },
      recordActivity: async (hostId, type, hostName) => {
        activities.push({ hostId, type, hostName });
      },
      status: {
        get: (hostId) => hostStatuses.get(hostId) ?? null,
        check: async (hostId) => hostStatuses.get(hostId) ?? null,
        reportLogin: (hostId, outcome) => {
          statusReports.push({ hostId, ...outcome });
        },
        registerPort: (connectionType, resolve) => {
          statusPorts.set(connectionType, resolve);
          return () => {
            statusPorts.delete(connectionType);
          };
        },
      },
    },

    schedule: {
      every: (intervalMs, fn, scheduleOptions) => {
        const stop = schedule("every", intervalMs, fn);
        if (scheduleOptions?.runNow) void fn();
        return stop;
      },
      after: (delayMs, fn) => schedule("after", delayMs, fn),
    },

    audit: {
      record: async (entry) => {
        audits.push({ ...entry });
      },
    },

    ssh: {
      connect: async (host, connectOptions) => {
        sshConnections.push({ host, options: connectOptions });
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
      dropPooled: (pool, hostId) => {
        droppedPools.push({ pool, hostId });
      },
      poolKey: (pool, host) =>
        `${pool}:${host.userId}:${host.ip}:${host.port}:${host.username}`,
      resolveHost: async (hostId, resolveOptions) =>
        (options.sshHosts ?? []).find((host) =>
          resolveOptions?.syncId
            ? host.syncId === resolveOptions.syncId
            : host.id === hostId,
        ) ?? null,
      prepare: async () => ({
        config: {},
        outcome: { status: "ready" },
        authType: null,
      }),
      openTransport: async () => ({ jumpClient: null, via: "direct" }),
      startInteraction: async (interaction, request) => {
        interactions.push({ action: "start", interaction, request });
      },
      cancelInteraction: async (interaction, request) => {
        interactions.push({ action: "cancel", interaction, request });
      },
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
      // Matches core: the built-in types, plus any registered provider that
      // does not opt out. An unknown type cannot connect unattended.
      supportsBackground: (authType) => {
        if (["password", "key", "credential", "agent"].includes(authType)) {
          return true;
        }
        const provider = auth.sshAuthProviders.find(
          (candidate) => candidate.type === authType,
        );
        return !!provider && provider.supportsBackground !== false;
      },
    },

    auth: {
      registerSshAuthProvider: (provider) => {
        auth.sshAuthProviders.push(provider);
      },
      registerKeyboardInteractiveHandler: (handler) => {
        auth.keyboardInteractiveHandlers.push(handler);
      },
      registerLoginMethod: (method) => {
        auth.loginMethods.push(method);
      },
      registerSecondFactor: (factor) => {
        auth.secondFactors.push(factor);
      },
      recordEnrollment: async (userId, factorId) => {
        if (options.refuseEnrollment) {
          throw new LoginMethodError(options.refuseEnrollment, 409);
        }
        auth.enrollments.add(`${userId}:${factorId}`);
      },
      removeEnrollment: async (userId, factorId) => {
        auth.enrollments.delete(`${userId}:${factorId}`);
      },
      // Stands in for core's pipeline: answers with the identity as JSON, or
      // redirects back with the error the way core does.
      completeRedirectLogin: async (methodId, req, res) => {
        const response = res as FakeResponse;
        const method = auth.loginMethods.find(
          (candidate) => candidate.id === methodId,
        );
        if (!method?.callback) {
          throw new Error(`No registered redirect method "${methodId}"`);
        }
        try {
          const identity = await method.callback(req as PluginLoginRequest);
          auth.completedLogins.push({ methodId, identity });
          response.status(200).json({ completed: methodId, identity });
        } catch (error) {
          const returnTo = (error as { returnTo?: string }).returnTo;
          const message = (error as Error).message;
          if (returnTo) {
            const url = new URL(returnTo);
            url.searchParams.set(
              "error",
              (error as { code?: string }).code ?? message,
            );
            response.redirect(url.toString());
            return;
          }
          response
            .status((error as { status?: number }).status ?? 500)
            .json({ error: message });
        }
      },
      revokeSessions: async (match) => {
        if (!match.sub && !match.sid) return 0;
        auth.revokedSessions.push(match);
        return 1;
      },
      loginRateLimit: {
        isLocked: async (ip, key) => {
          const failures = auth.loginFailures.get(`${ip}|${key}`) ?? 0;
          return failures >= (options.loginAttemptLimit ?? 5)
            ? { locked: true, remainingTime: 60 }
            : { locked: false };
        },
        recordFailure: async (ip, key) => {
          const id = `${ip}|${key}`;
          auth.loginFailures.set(id, (auth.loginFailures.get(id) ?? 0) + 1);
        },
      },
      countLinkedUsers: async (provider) =>
        options.linkedUsers?.[provider] ?? 0,
    },

    desktop: {
      openIsolatedWindow: async (request) => {
        desktopWindows.push(request);
        return { success: true };
      },
      launchNativeRdp: async (request) => {
        nativeRdpLaunches.push(request);
        return { success: true };
      },
      available: () => options.desktopAvailable ?? false,
    },

    credentials: {
      listSshKeys: async () => [
        ...(options.sshKeyCredentials ?? []),
        ...createdSshKeys.map((key) => ({
          id: key.id,
          name: key.name,
          username: key.username ?? null,
          publicKey: key.publicKey,
        })),
      ],
      createSshKey: async (input) => {
        const id =
          Math.max(
            0,
            ...(options.sshKeyCredentials ?? []).map((key) => key.id),
            ...createdSshKeys.map((key) => key.id),
          ) + 1;
        createdSshKeys.push({ ...input, id });
        return { id };
      },
      resolveHostProtocol: async (hostId, protocol) => {
        credentialReads.push({ hostId, protocol });
        return options.protocolTargets?.[`${hostId}:${protocol}`] ?? null;
      },
      registerSecretResolver: (scheme, resolve) => {
        auth.secretResolvers.set(scheme, resolve);
        disposals.push(() => {
          auth.secretResolvers.delete(scheme);
        });
      },
    },

    notify: {
      channels: async () => options.notificationChannels ?? [],
      send: async (channelIds, notification) => {
        notifications.push({ actor, channelIds, notification });
        const selected = (options.notificationChannels ?? []).filter(
          (channel) => channelIds.includes(channel.id) && channel.enabled,
        );
        return { delivered: selected.length, failures: [] };
      },
    },

    fetch: async (url, init) => {
      fetches.push({ url, init });
      if (!options.fetch) throw new Error("ctx.fetch is not stubbed");
      return options.fetch(url, init);
    },

    process: {
      run: async (file, args, runOptions) => {
        processRuns.push({ file, args, options: runOptions });
        if (!options.process?.run) {
          throw new Error("ctx.process.run is not stubbed");
        }
        return options.process.run(file, args, runOptions);
      },
      ensureBinary: async (spec) => {
        binaries.push(spec);
        if (options.process?.ensureBinary) {
          return options.process.ensureBinary(spec);
        }
        return `/tmp/${pluginId}/bin/${spec.name}`;
      },
    },

    system: {
      tlsStatus: async () => {
        tls.calls.push("tlsStatus");
        return {
          ...tlsState,
          renewal: tls.renewers > 0 ? { pluginId, pluginName: pluginId } : null,
        };
      },
      writeTlsCertificate: async (certificatePem, privateKeyPem) => {
        tls.calls.push("writeTlsCertificate");
        const info = options.validateTls
          ? options.validateTls(certificatePem, privateKeyPem)
          : {
              subject: "CN=fake",
              issuer: "CN=fake-ca",
              names: [],
              notBefore: new Date().toISOString(),
              notAfter: new Date(Date.now() + 90 * 86_400_000).toISOString(),
              selfSigned: false,
              fingerprint: "00",
            };
        tls.writes.push({ certificatePem, privateKeyPem });
        tlsState = { ...tlsState, certificate: info };
        return info;
      },
      reloadTls: async () => {
        tls.calls.push("reloadTls");
        tls.reloads++;
        return { applied: true, message: "reloaded" };
      },
      publishHttpChallenge: async (token, content) => {
        tls.calls.push("publishHttpChallenge");
        tls.challenges.set(token, content);
        let live = true;
        const remove = () => {
          if (!live) return;
          live = false;
          tls.challenges.delete(token);
        };
        disposals.push(remove);
        return remove;
      },
      registerTlsRenewer: async () => {
        tls.calls.push("registerTlsRenewer");
        tls.renewers++;
        let live = true;
        const remove = () => {
          if (!live) return;
          live = false;
          tls.renewers--;
        };
        disposals.push(remove);
        return remove;
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
    validateSettings: async (scope, values, context = {}) => {
      const errors: Record<string, string> = {};
      for (const entry of settingsValidators) {
        if (entry.scope !== scope) continue;
        Object.assign(errors, (await entry.validator(values, context)) ?? {});
      }
      return errors;
    },
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
    desktopWindows,
    nativeRdpLaunches,
    credentialReads,
    createdSshKeys,
    notifications,
    fetches,
    processRuns,
    binaries,
    tls,
    secretStore,
    audits,
    activities,
    trackedSessions,
    interactions,
    statusReports,
    statusPorts,
    hostStatuses,
    droppedPools,
    scheduled,
    runScheduled: async () => {
      for (const job of scheduled.filter((candidate) => !candidate.stopped)) {
        if (job.kind === "after") job.stopped = true;
        await job.fn();
      }
    },
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
  /** Hosts ctx.hosts.list/get/checkAccess serve. See FakeContextOptions. */
  hosts?: PluginHostSummary[];
  /** Other plugins' services. See FakeContextOptions. */
  services?: Record<string, object>;
  /** Hosts ctx.ssh.resolveHost serves. See FakeContextOptions. */
  sshHosts?: PluginSshHost[];
  /** What ctx.credentials serves. See FakeContextOptions. */
  protocolTargets?: Record<string, PluginProtocolTarget>;
  /** What ctx.credentials.listSshKeys serves. */
  sshKeyCredentials?: PluginSshKeyCredential[];
  /** What ctx.desktop.available() answers. */
  desktopAvailable?: boolean;
  /** What ctx.hosts.status answers. See FakeContextOptions. */
  hostStatuses?: Record<number, PluginHostStatusEntry>;
  /** The acting user's channels, what ctx.notify.channels answers. */
  notificationChannels?: PluginNotificationChannel[];
  /**
   * Answers ctx.fetch. Without it every fetch rejects, so a test never
   * reaches the network by accident.
   */
  fetch?: (url: string, init?: PluginFetchInit) => Promise<Response>;
  /** See FakeContextOptions. */
  process?: FakeProcessOptions;
  /** See FakeContextOptions. */
  tlsStatus?: FakeContextOptions["tlsStatus"];
  /** See FakeContextOptions. */
  validateTls?: FakeContextOptions["validateTls"];
  /** See FakeContextOptions. */
  refuseEnrollment?: string;
  /** See FakeContextOptions. */
  baseUrl?: string;
  /** See FakeContextOptions. */
  linkedUsers?: Record<string, number>;
  /** See FakeContextOptions. */
  loginAttemptLimit?: number;
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
 * ctx.settings.readCore, ssh:connect plus credentials:use on ctx.ssh,
 * notify:send on ctx.notify, network:outbound on ctx.fetch, process:spawn on
 * ctx.process, system:tls on ctx.system, and auth:provide on ctx.auth. Reading a plugin's own settings is deliberately
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
    hosts: options.hosts,
    sshHosts: options.sshHosts,
    services: options.services,
    protocolTargets: options.protocolTargets,
    sshKeyCredentials: options.sshKeyCredentials,
    desktopAvailable: options.desktopAvailable,
    hostStatuses: options.hostStatuses,
    notificationChannels: options.notificationChannels,
    fetch: options.fetch,
    process: options.process,
    tlsStatus: options.tlsStatus,
    validateTls: options.validateTls,
    refuseEnrollment: options.refuseEnrollment,
    baseUrl: options.baseUrl,
    linkedUsers: options.linkedUsers,
    loginAttemptLimit: options.loginAttemptLimit,
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
      persist: async (persistOptions) => {
        require("db:own");
        return guardedDb.persist(persistOptions);
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

    files: {
      dataDir: async () => {
        require("files:own");
        return ctx.files.dataDir();
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
      on: (topic, listener) => {
        if (!topic.startsWith("plugin.") && !granted.has("events:core")) {
          throw new Error(
            `Plugin ${pluginId} may only listen to "plugin.*" topics. ` +
              `Declare the events:core capability to listen to core topics.`,
          );
        }
        return ctx.events.on(topic, listener);
      },
    },

    http: {
      router: (routerOptions) => {
        require("network:serve");
        return ctx.http.router(routerOptions);
      },
      baseUrl: (req) => ctx.http.baseUrl(req),
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
      listHostValues: async (key) => {
        require("hosts:read");
        return ctx.settings.listHostValues(key);
      },
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
      delete: async (hostId) => {
        require("hosts:write");
        return ctx.hosts.delete(hostId);
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
      trackSession: (hostId) => {
        require("hosts:read");
        return ctx.hosts.trackSession(hostId);
      },
      recordActivity: async (hostId, type, hostName) => {
        require("hosts:read");
        return ctx.hosts.recordActivity(hostId, type, hostName);
      },
      status: {
        get: (hostId) => {
          require("hosts:read");
          return ctx.hosts.status.get(hostId);
        },
        check: async (hostId) => {
          require("hosts:read");
          return ctx.hosts.status.check(hostId);
        },
        reportLogin: (hostId, outcome) => {
          require("hosts:read");
          ctx.hosts.status.reportLogin(hostId, outcome);
        },
        registerPort: (connectionType, resolve) => {
          require("hosts:read");
          return ctx.hosts.status.registerPort(connectionType, resolve);
        },
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
      openTransport: async (host, config, transportOptions) => {
        require("ssh:connect");
        return ctx.ssh.openTransport(host, config, transportOptions);
      },
      resolveHost: async (hostId, resolveOptions) => {
        require("ssh:connect");
        require("credentials:use");
        return ctx.ssh.resolveHost(hostId, resolveOptions);
      },
      startInteraction: async (interaction, request) => {
        require("ssh:connect");
        require("credentials:use");
        return ctx.ssh.startInteraction(interaction, request);
      },
      cancelInteraction: async (interaction, request) => {
        require("ssh:connect");
        return ctx.ssh.cancelInteraction(interaction, request);
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
      registerKeyboardInteractiveHandler: (handler) => {
        require("auth:provide");
        ctx.auth.registerKeyboardInteractiveHandler(handler);
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
      completeRedirectLogin: async (methodId, req, res) => {
        require("auth:provide");
        return ctx.auth.completeRedirectLogin(methodId, req, res);
      },
      revokeSessions: async (match) => {
        require("auth:provide");
        return ctx.auth.revokeSessions(match);
      },
      loginRateLimit: {
        isLocked: async (ip, key) => {
          require("auth:provide");
          return ctx.auth.loginRateLimit.isLocked(ip, key);
        },
        recordFailure: async (ip, key) => {
          require("auth:provide");
          return ctx.auth.loginRateLimit.recordFailure(ip, key);
        },
      },
      countLinkedUsers: async (provider) => {
        require("auth:provide");
        return ctx.auth.countLinkedUsers(provider);
      },
    },

    desktop: {
      openIsolatedWindow: async (request) => {
        require("desktop:window");
        return ctx.desktop.openIsolatedWindow(request);
      },
      launchNativeRdp: async (request) => {
        require("desktop:window");
        return ctx.desktop.launchNativeRdp(request);
      },
      available: () => ctx.desktop.available(),
    },

    credentials: {
      listSshKeys: async () => {
        require("credentials:use");
        return ctx.credentials.listSshKeys();
      },
      createSshKey: async (input) => {
        require("credentials:write");
        return ctx.credentials.createSshKey(input);
      },
      resolveHostProtocol: async (hostId, protocol) => {
        require("credentials:read");
        return ctx.credentials.resolveHostProtocol(hostId, protocol);
      },
      registerSecretResolver: (scheme, resolve) => {
        require("auth:provide");
        ctx.credentials.registerSecretResolver(scheme, resolve);
      },
    },

    notify: {
      channels: async () => {
        require("notify:send");
        return ctx.notify.channels();
      },
      send: async (channelIds, notification) => {
        require("notify:send");
        return ctx.notify.send(channelIds, notification);
      },
    },

    fetch: async (url, init) => {
      require("network:outbound");
      return ctx.fetch(url, init);
    },

    process: {
      run: async (file, args, runOptions) => {
        require("process:spawn");
        return ctx.process.run(file, args, runOptions);
      },
      ensureBinary: async (spec) => {
        require("process:spawn");
        return ctx.process.ensureBinary(spec);
      },
    },

    system: {
      tlsStatus: async () => {
        require("system:tls");
        return ctx.system.tlsStatus();
      },
      writeTlsCertificate: async (certificatePem, privateKeyPem) => {
        require("system:tls");
        return ctx.system.writeTlsCertificate(certificatePem, privateKeyPem);
      },
      reloadTls: async () => {
        require("system:tls");
        return ctx.system.reloadTls();
      },
      publishHttpChallenge: async (token, content) => {
        require("system:tls");
        return ctx.system.publishHttpChallenge(token, content);
      },
      registerTlsRenewer: async () => {
        require("system:tls");
        return ctx.system.registerTlsRenewer();
      },
    },

    secrets: {
      ...ctx.secrets,
      get: async (key) => {
        require("secrets:own");
        return ctx.secrets.get(key);
      },
      set: async (key, value) => {
        require("secrets:own");
        return ctx.secrets.set(key, value);
      },
      delete: async (key) => {
        require("secrets:own");
        return ctx.secrets.delete(key);
      },
      seal: async (value) => {
        require("secrets:own");
        return ctx.secrets.seal(value);
      },
      unseal: async (sealed) => {
        require("secrets:own");
        return ctx.secrets.unseal(sealed);
      },
    },

    capabilities: {
      has: async (capability) => granted.has(capability),
      require: async (capability) => {
        require(capability);
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
    "CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL DEFAULT '', is_admin INTEGER NOT NULL DEFAULT 0)",
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
    users: builder.buildRefTable("users", {
      id: "text",
      username: "text",
      isAdmin: "boolean",
    }),
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
    hostProtocols: () => string[];
    hostEditorSections: () => string[];
    dashboardCards: () => string[];
    settingsComponents: () => string[];
    slot: (slotId: string) => string[];
    actions: () => string[];
    loginMethods: () => string[];
    secondFactors: () => string[];
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
  /** Renders a login method's UI with login screen props, overridable. */
  renderLoginMethod: (
    id: string,
    props?: Record<string, unknown>,
  ) => HTMLElement;
  /** Renders a second factor's challenge with overridable props. */
  renderSecondFactor: (
    id: string,
    props?: Record<string, unknown>,
  ) => HTMLElement;
  /** Renders the Settings > Security section a factor or method brought. */
  renderEnrollment: (id: string) => HTMLElement;
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
