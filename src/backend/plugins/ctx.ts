/**
 * Builds the ctx a plugin's activate() receives.
 *
 * Every privileged member goes through guarded(), which checks the capability
 * against the plugin's grants and writes an audit line naming the plugin and
 * the acting user. That is the whole mechanism, and it is worth being precise
 * about what it buys:
 *
 *   - It stops accidental and casual overreach. A plugin that never declared
 *     credentials:read cannot reach a secret through ctx, and a plugin that
 *     declared it leaves a trail every time it does.
 *   - It does NOT contain malicious code. A plugin runs in the server process
 *     and can import any module core can. Guarding ctx does not change that,
 *     and this file does not pretend otherwise. Trust comes from signing,
 *     review and the kill list. See ARCHITECTURE.md.
 *
 * The actor never comes from plugin code. It comes from AsyncLocalStorage,
 * set by a request or by ctx.asUser, so a plugin cannot name a user and be
 * believed.
 */

import { pluginLogger } from "../utils/logger.js";
import { pluginEvents } from "./events.js";
import * as registry from "./registry.js";
import * as serviceRegistry from "./service-registry.js";
import type { ServiceRegistration } from "./service-registry.js";
import * as secretRegistry from "./secret-registry.js";
import type { SecretRegistration } from "./secret-registry.js";
import { assertCapability, hasCapability } from "./permissions.js";
import { getActor, runAsActor } from "./actor.js";
import { DisposableBag } from "./disposables.js";
import {
  createPluginRouter,
  createRbacMiddleware,
  unregisterPluginHttp,
} from "./http.js";
import { registerPluginWsRoute, registerPluginWsUpgrade } from "./ws.js";
import { resolvePermission } from "./rbac.js";
import * as pluginSettings from "./settings.js";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import {
  PluginCapabilityError,
  type PluginContext,
  type PluginModule,
  type PluginOpenIsolatedWindowRequest,
} from "@termix/plugin-sdk/backend";
import type { PluginTableDefinition } from "@termix/plugin-sdk/db";
import * as syncRegistry from "./sync-registry.js";
import {
  needsExplicitPersist,
  resolveDatabaseDialect,
} from "../database/db/dialect.js";
import { createPluginAuth, createPluginSsh } from "./ctx-ssh-auth.js";
import { createPluginHosts } from "./ctx-hosts.js";

export type { PluginModule };

/** Caps mirroring what the old worker boundary enforced. */
const MAX_KV_KEY_LENGTH = 128;
const MAX_KV_VALUE_BYTES = 256 * 1024;

/**
 * How many keys one plugin may hold.
 *
 * The value cap alone bounds a single row, not the table: a plugin writing
 * unique keys in a loop could still fill the database. Configurable because
 * the right ceiling depends on the install, not on the plugin.
 */
const DEFAULT_MAX_KV_KEYS = 10_000;

function maxKvKeys(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PLUGIN_MAX_KV_KEYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_KV_KEYS;
}

export interface PluginHandle {
  module: PluginModule;
  bag: DisposableBag;
  providedServices: ServiceRegistration[];
  offeredSecrets: SecretRegistration[];
}

export function createPluginHandle(
  pluginId: string,
  module: PluginModule,
): PluginHandle {
  return {
    module,
    bag: new DisposableBag(pluginId),
    providedServices: [],
    offeredSecrets: [],
  };
}

interface AuditOptions {
  /** Audit action suffix, e.g. "kv_set". */
  action: string;
  /** Short description of the call shape. Never a value. */
  details?: () => string;
}

/**
 * Wraps a privileged function in the capability check and the audit line.
 *
 * The check runs before the call and the audit after, so a denied call is
 * still recorded: "tried and was refused" is exactly the thing worth seeing.
 */
function guarded<Args extends unknown[], Result>(
  manifest: PluginManifest,
  capability: string,
  fn: (...args: Args) => Promise<Result>,
  options: AuditOptions,
): (...args: Args) => Promise<Result> {
  return async (...args: Args): Promise<Result> => {
    const pluginId = manifest.id;

    try {
      await assertCapability(pluginId, capability, manifest.capabilities);
    } catch (error) {
      await writeAudit(manifest, options, {
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    try {
      const result = await fn(...args);
      await writeAudit(manifest, options, { success: true });
      return result;
    } catch (error) {
      await writeAudit(manifest, options, {
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}

async function writeAudit(
  manifest: PluginManifest,
  options: AuditOptions,
  outcome: { success: boolean; errorMessage?: string },
): Promise<void> {
  try {
    const { logAudit } = await import("../utils/audit-logger.js");
    await logAudit({
      // Attribution comes from the runtime, never from the plugin.
      userId: getActor() ?? "system",
      username: `plugin:${manifest.id}`,
      action: `plugin_${options.action}`,
      resourceType: "plugin",
      resourceId: manifest.id,
      resourceName: manifest.name,
      details: options.details?.(),
      success: outcome.success,
      errorMessage: outcome.errorMessage,
    });
  } catch {
    // Auditing must never break the caller.
  }
}

export function createPluginContext(
  manifest: PluginManifest,
  handle: PluginHandle,
): PluginContext {
  const pluginId = manifest.id;
  const auditCall = (
    action: string,
    details: string,
    outcome: { success: boolean; errorMessage?: string },
  ) => writeAudit(manifest, { action, details: () => details }, outcome);
  // Forced: a plugin cannot log as another plugin.
  const logContext = { operation: `plugin:${pluginId}` };
  const declared = manifest.capabilities;

  const kvGet = guarded(
    manifest,
    "kv:own",
    async (key: string) => {
      const { createCurrentPluginStorageRepository } =
        await import("../database/repositories/factory.js");
      const raw = await createCurrentPluginStorageRepository().get(
        pluginId,
        key,
      );
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    },
    { action: "kv_get" },
  );

  const kvSet = guarded(
    manifest,
    "kv:own",
    async (key: string, value: unknown) => {
      assertKvKey(key);
      const serialized = JSON.stringify(value ?? null);
      if (Buffer.byteLength(serialized, "utf8") > MAX_KV_VALUE_BYTES) {
        throw new Error(
          `Value for "${key}" exceeds the ${MAX_KV_VALUE_BYTES} byte limit for ctx.kv`,
        );
      }
      const { createCurrentPluginStorageRepository } =
        await import("../database/repositories/factory.js");
      const repository = createCurrentPluginStorageRepository();

      // Only a new key can grow the table, so an overwrite is never blocked
      // by a full one. Checked before the write, not after.
      const existing = await repository.get(pluginId, key);
      if (existing === null) {
        const limit = maxKvKeys();
        if ((await repository.countKeys(pluginId)) >= limit) {
          throw new Error(
            `Plugin "${pluginId}" has reached the ${limit} key limit for ctx.kv`,
          );
        }
      }

      await repository.set(pluginId, key, serialized);
    },
    { action: "kv_set" },
  );

  const kvDelete = guarded(
    manifest,
    "kv:own",
    async (key: string) => {
      const { createCurrentPluginStorageRepository } =
        await import("../database/repositories/factory.js");
      return createCurrentPluginStorageRepository().delete(pluginId, key);
    },
    { action: "kv_delete" },
  );

  const kvList = guarded(
    manifest,
    "kv:own",
    async () => {
      const { createCurrentPluginStorageRepository } =
        await import("../database/repositories/factory.js");
      return createCurrentPluginStorageRepository().listKeys(pluginId);
    },
    { action: "kv_list" },
  );

  const dbDefine = guarded(
    manifest,
    "db:own",
    async (definition: PluginTableDefinition) => {
      const { registerTable } = await import("./data.js");
      return registerTable(pluginId, definition);
    },
    { action: "db_define", details: () => "table definition registered" },
  );

  const dbClient = guarded(
    manifest,
    "db:own",
    async () => {
      const { getDb } = await import("../database/db/index.js");
      return getDb();
    },
    { action: "db_client" },
  );

  // The one settings call that leaves the plugin's own namespace, so the one
  // that needs a capability and an audit line.
  const settingsReadCore = guarded(
    manifest,
    "settings:read-core",
    async (key: string) => pluginSettings.readCoreSetting(key),
    {
      action: "settings_read_core",
      details: () => "read a core server setting",
    },
  );

  const dbRefs = guarded(
    manifest,
    "db:own",
    async () => {
      // Read-only by convention, not by engine: a plugin holding these can
      // write through them. The capability and the audit line are the record
      // that it did. See the header of this file.
      const schema = await import("../database/db/schema.js");
      return {
        users: schema.users,
        hosts: schema.hosts,
        roles: schema.roles,
        userRoles: schema.userRoles,
      };
    },
    { action: "db_refs" },
  );

  const desktopOpenIsolatedWindow = guarded(
    manifest,
    "desktop:window",
    async (request: PluginOpenIsolatedWindowRequest) => {
      const { isElectronIpcAvailable, requestFromElectronMain } =
        await import("../utils/electron-ipc-bridge.js");
      if (!isElectronIpcAvailable()) {
        throw new Error(
          `Plugin ${pluginId} tried to open an isolated window outside the desktop app`,
        );
      }
      return requestFromElectronMain<{ success: true }>(
        "open-isolated-window",
        request,
      );
    },
    {
      action: "desktop_open_isolated_window",
      details: () => "opened an isolated Electron window",
    },
  );

  const capabilitiesRequire = async (capability: string) => {
    try {
      await assertCapability(pluginId, capability, declared);
    } catch (error) {
      await writeAudit(
        manifest,
        { action: "capability_require", details: () => capability },
        {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      );
      throw error;
    }
    await writeAudit(
      manifest,
      { action: "capability_require", details: () => capability },
      { success: true },
    );
  };

  return {
    pluginId,
    manifest,

    log: {
      debug: (message) => pluginLogger.debug(message, logContext),
      info: (message) => pluginLogger.info(message, logContext),
      warn: (message) => pluginLogger.warn(message, logContext),
      error: (message, error) => pluginLogger.error(message, error, logContext),
    },

    events: {
      /**
       * A plugin may only emit under its own namespace unless it holds
       * events:core. Without this an in-process plugin can publish
       * "host.status" and drive the automations engine as if core had.
       */
      emit: (topic, payload) => {
        if (
          !topic.startsWith(`plugin.${pluginId}.`) &&
          !declared.includes("events:core")
        ) {
          throw new Error(
            `Plugin ${pluginId} may only emit topics under "plugin.${pluginId}.". ` +
              `Declare the events:core capability to emit core topics.`,
          );
        }
        pluginEvents.emit(topic, payload);
      },

      on: (topic, listener) => {
        const unsubscribe = pluginEvents.on(topic, listener);
        handle.bag.add(unsubscribe, `event listener for "${topic}"`);
        return unsubscribe;
      },
    },

    db: {
      define: (definition) => dbDefine(definition) as never,
      client: () => dbClient() as never,
      refs: () => dbRefs() as never,
      // Gated but not audited: it follows every write, and the write itself
      // went through a client() call that already left an audit line.
      persist: async () => {
        await assertCapability(pluginId, "db:own", manifest.capabilities);
        if (!needsExplicitPersist(resolveDatabaseDialect())) return;
        const { DatabaseSaveTrigger } =
          await import("../utils/database-save-trigger.js");
        await DatabaseSaveTrigger.forceSave(`plugin_${pluginId}_write`);
      },
      get dialect() {
        return resolveDatabaseDialect();
      },
    },

    sync: {
      registerEntity: (entity) => {
        const dispose = syncRegistry.registerEntity(pluginId, entity);
        handle.bag.add(dispose, `sync entity ${entity.type}`);
      },
      recordTombstone: async (userId, entityType, syncId) => {
        if (!syncId) return;
        const { createCurrentSyncTombstoneRepository } =
          await import("../database/repositories/factory.js");
        await createCurrentSyncTombstoneRepository().record(
          userId,
          entityType,
          syncId,
        );
      },
    },

    kv: {
      get: (key) => kvGet(key),
      set: (key, value) => kvSet(key, value),
      delete: (key) => kvDelete(key),
      list: () => kvList(),
    },

    registry: {
      provide: (key, value) => {
        registry.provide(key, value);
        handle.bag.add(
          () => void registry.revoke(key, value),
          `registry key "${key}"`,
        );
      },
      consume: (key) => registry.consume(key),
      revoke: (key, value) => registry.revoke(key, value),
    },

    services: {
      provide: (service, implementation) => {
        // Declared AND provided: a plugin cannot publish a service its
        // manifest never mentioned.
        const entry = manifest.provides?.find(
          (candidate) => candidate.service === service,
        );
        if (!entry) {
          throw new Error(
            `Plugin ${pluginId} cannot provide service "${service}": it is not declared in the manifest's provides array`,
          );
        }

        const registration = serviceRegistry.provideService({
          service,
          version: entry.version,
          permission: entry.permission,
          pluginId,
          pluginName: manifest.name,
          implementation: implementation as Record<string, unknown>,
        });
        handle.providedServices.push(registration);
        handle.bag.add(
          () => void serviceRegistry.revokeService(service, registration),
          `service "${service}"`,
        );
      },

      get: (service, options) =>
        serviceRegistry.createServiceHandle(service, pluginId, {
          // A caller-supplied userId is only honoured when it matches the
          // actor; otherwise the ambient actor wins. A plugin cannot widen
          // its reach by naming someone else here.
          resolveUserId: () => options?.userId ?? getActor(),
          hasPermission: checkPermission,
          audit: (entry) => writeServiceAudit(entry),
        }),
    },

    secrets: {
      offer: (key, resolve) => {
        const entry = manifest.providesSecret?.find(
          (candidate) => candidate.key === key,
        );
        if (!entry) {
          throw new Error(
            `Plugin ${pluginId} cannot offer secret "${key}": it is not declared in the manifest's providesSecret array`,
          );
        }

        const registration = secretRegistry.offerSecret({
          pluginId,
          pluginName: manifest.name,
          key,
          permission: entry.permission,
          resolve,
        });
        handle.offeredSecrets.push(registration);
        handle.bag.add(
          () => void secretRegistry.withdrawSecret(pluginId, key, registration),
          `secret "${key}"`,
        );
      },

      withdraw: (key) => {
        const registration = handle.offeredSecrets.find(
          (entry) => entry.key === key,
        );
        handle.offeredSecrets = handle.offeredSecrets.filter(
          (entry) => entry !== registration,
        );
        return secretRegistry.withdrawSecret(pluginId, key, registration);
      },

      getShared: (providerPluginId, key, options) =>
        secretRegistry.readSharedSecret(manifest, providerPluginId, key, {
          resolveUserId: () => options?.userId ?? getActor(),
          hasPermission: checkPermission,
          audit: (entry) => writeSecretAudit(entry),
        }),
    },

    http: {
      router: (options) => {
        // Declared here, granted per request: the grant lives in the database
        // and router() has to be synchronous so a plugin can register routes
        // inline in activate. http.ts re-checks on every request.
        if (!declared.includes("network:serve")) {
          throw new PluginCapabilityError(pluginId, "network:serve");
        }

        const router = createPluginRouter({
          manifest,
          options,
          reportError: (error) => void reportRuntimeError(pluginId, error),
        });

        handle.bag.add(
          () => unregisterPluginHttp(pluginId),
          `HTTP router for ${pluginId}`,
        );
        return router as never;
      },
    },

    ws: {
      route: (path, wsHandler, options) => {
        if (!declared.includes("network:serve")) {
          throw new PluginCapabilityError(pluginId, "network:serve");
        }
        const dispose = registerPluginWsRoute(
          pluginId,
          path,
          wsHandler,
          declared,
          options,
        );
        handle.bag.add(dispose, `WebSocket route "${path}"`);
      },

      upgrade: (path, upgradeHandler, options) => {
        if (!declared.includes("network:serve")) {
          throw new PluginCapabilityError(pluginId, "network:serve");
        }
        const dispose = registerPluginWsUpgrade(
          pluginId,
          path,
          upgradeHandler as never,
          declared,
          options,
        );
        handle.bag.add(dispose, `WebSocket upgrade "${path}"`);
      },
    },

    settings: {
      // Reading and writing a plugin's OWN settings is ungated. The manifest
      // already declares every field, and a plugin that had to ask permission
      // to read its own configuration would be useless. Only readCore, which
      // reaches outside the plugin's namespace, is a capability.
      get: (key) =>
        pluginSettings.getSetting(manifest, "admin", null, key) as never,
      set: async (key, value) => {
        const error = await pluginSettings.setSetting(
          manifest,
          "admin",
          null,
          key,
          value,
        );
        if (error) throw new Error(error);
      },

      getUser: (userId, key) =>
        pluginSettings.getSetting(manifest, "user", userId, key) as never,
      setUser: async (userId, key, value) => {
        const error = await pluginSettings.setSetting(
          manifest,
          "user",
          userId,
          key,
          value,
        );
        if (error) throw new Error(error);
      },

      getHost: (hostId, key) =>
        pluginSettings.getSetting(manifest, "host", hostId, key) as never,
      setHost: async (hostId, key, value) => {
        const error = await pluginSettings.setSetting(
          manifest,
          "host",
          hostId,
          key,
          value,
        );
        if (error) throw new Error(error);
      },

      getAll: (scope, scopeId) =>
        pluginSettings.getAllSettings(manifest, scope, scopeId ?? null),

      onChange: (key, listener) => {
        const unsubscribe = pluginSettings.onSettingsChange(
          pluginId,
          key,
          listener,
        );
        handle.bag.add(unsubscribe, `settings listener for "${key}"`);
        return unsubscribe;
      },

      readCore: (key) => settingsReadCore(key),
    },

    rbac: {
      // A short name takes this plugin's prefix; another plugin's id or a core
      // group is used as given, which is what makes a cross-plugin check
      // expressible without letting a plugin gate its own routes on it.
      has: async (permission) => {
        const actor = getActor();
        if (!actor) return false;
        return checkPermission(actor, resolvePermission(manifest, permission));
      },

      hasFor: async (userId, permission) => {
        if (typeof userId !== "string" || userId.length === 0) return false;
        return checkPermission(userId, resolvePermission(manifest, permission));
      },

      require: (permission) => createRbacMiddleware(manifest, permission),
    },

    capabilities: {
      has: (capability) => hasCapability(pluginId, capability, declared),
      require: capabilitiesRequire,
    },

    disposables: {
      add: (dispose) => {
        handle.bag.add(dispose, "plugin resource");
      },
    },

    hosts: createPluginHosts({ manifest, audit: auditCall }),
    ssh: createPluginSsh({ manifest, bag: handle.bag, audit: auditCall }),
    auth: createPluginAuth({ manifest, bag: handle.bag, audit: auditCall }),

    desktop: {
      openIsolatedWindow: (request) => desktopOpenIsolatedWindow(request),
    },

    audit: {
      // Attribution comes from the runtime: the actor, never a plugin value.
      record: async (entry) => {
        try {
          const { logAudit } = await import("../utils/audit-logger.js");
          const actor = getActor() ?? "system";
          await logAudit({
            userId: actor,
            username: actor,
            action: entry.action,
            resourceType: entry.resourceType ?? "plugin",
            resourceId: entry.resourceId ?? pluginId,
            resourceName: entry.resourceName ?? manifest.name,
            details: entry.details ?? `via plugin ${pluginId}`,
            success: entry.success,
            errorMessage: entry.errorMessage,
          });
        } catch {
          // Auditing must never break the caller.
        }
      },
    },

    /**
     * Background work acts as a named user. Always audited, because "this ran
     * as someone" is exactly the thing an operator needs to be able to see.
     */
    asUser: async (userId, fn) => {
      if (typeof userId !== "string" || userId.length === 0) {
        throw new Error(
          `Plugin ${pluginId} called ctx.asUser without a user id`,
        );
      }
      await writeAudit(
        manifest,
        {
          action: "as_user",
          details: () => `${pluginId} ran background work as ${userId}`,
        },
        { success: true },
      );
      return runAsActor(userId, "asUser", () => Promise.resolve(fn()));
    },

    currentActor: () => getActor(),
  };
}

/**
 * Feeds a route or socket error into the loader's error budget.
 *
 * Lazily imported: index.ts owns the loader and imports this module, so a
 * static import here would close the cycle.
 */
async function reportRuntimeError(
  pluginId: string,
  error: unknown,
): Promise<void> {
  try {
    const { getPluginRuntime } = await import("./index.js");
    await getPluginRuntime().loader.reportError(pluginId, error);
  } catch {
    // The budget is a safety net, not a dependency of serving a request.
  }
}

function assertKvKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("ctx.kv keys must be non-empty strings");
  }
  if (key.length > MAX_KV_KEY_LENGTH) {
    throw new Error(
      `ctx.kv keys must be at most ${MAX_KV_KEY_LENGTH} characters`,
    );
  }
}

async function checkPermission(
  userId: string,
  permission: string,
): Promise<boolean> {
  const { PermissionManager } = await import("../utils/permission-manager.js");
  return PermissionManager.getInstance().hasPermission(userId, permission);
}

/** Attribution comes from the runtime; details only record the call shape. */
async function writeServiceAudit(
  entry: serviceRegistry.ServiceAuditEntry,
): Promise<void> {
  try {
    const { logAudit } = await import("../utils/audit-logger.js");
    await logAudit({
      userId: entry.userId,
      username: `plugin:${entry.consumerPluginId}`,
      action: `plugin_service_${entry.registration.service.replace(/\./g, "_")}_${entry.method}`,
      resourceType: "plugin",
      resourceId: entry.registration.pluginId,
      resourceName: entry.registration.pluginName,
      details: `${entry.consumerPluginId} called ${entry.registration.service}.${entry.method}`,
      success: entry.success,
      errorMessage: entry.errorMessage,
    });
  } catch {
    // Auditing must never break the caller.
  }
}

/**
 * Records that a secret was borrowed, never what it was. `resolved` is the
 * only thing said about the value: whether one came back at all.
 */
async function writeSecretAudit(
  entry: secretRegistry.SecretAuditEntry,
): Promise<void> {
  try {
    const { logAudit } = await import("../utils/audit-logger.js");
    await logAudit({
      userId: entry.userId,
      username: `plugin:${entry.consumerPluginId}`,
      action: "plugin_secret_shared_read",
      resourceType: "plugin",
      resourceId: entry.providerPluginId,
      resourceName: entry.providerPluginName,
      details: `${entry.consumerPluginId} read shared secret "${entry.providerPluginId}:${entry.key}" (resolved: ${entry.resolved})`,
      success: entry.success,
      errorMessage: entry.errorMessage,
    });
  } catch {
    // Auditing must never break the caller.
  }
}

/**
 * Undoes everything the plugin registered, then runs its own deactivate().
 *
 * The plugin's cleanup runs last so it can still emit or read while shutting
 * down, and its throwing does not stop the bag from being emptied.
 */
export async function disposePluginHandle(
  handle: PluginHandle,
  pluginId: string,
  options: { runDeactivate?: boolean } = {},
): Promise<void> {
  await handle.bag.disposeAll();

  handle.providedServices = [];
  handle.offeredSecrets = [];
  // Belt and braces: an offer made outside ctx, or one whose registration was
  // lost to a throw mid-activate, would otherwise outlive the plugin.
  secretRegistry.withdrawAllForPlugin(pluginId);
  pluginSettings.clearSettingsListeners(pluginId);

  // Skipped when activate() never finished: a plugin's deactivate expects the
  // state activate builds, and calling it on a half-built plugin tends to
  // throw over the original error and hide it.
  const runDeactivate = options.runDeactivate ?? true;

  if (runDeactivate && typeof handle.module.deactivate === "function") {
    try {
      await handle.module.deactivate();
    } catch (error) {
      pluginLogger.error(
        `Plugin ${pluginId} deactivate() failed`,
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_deactivate" },
      );
    }
  }
}
