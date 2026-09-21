/**
 * The ctx handed to an in-process first-party plugin.
 *
 * Unlike the worker ctx built in worker-bootstrap.ts, nothing here is a
 * postMessage round trip and nothing is capability-gated. There would be no
 * point: the plugin is running on the main thread and could import any module
 * in the server directly. A gate it can trivially bypass is a false claim, not
 * a control, so this surface does not pretend to be one.
 *
 * What this ctx is actually for is lifecycle and identity: the plugin gets a
 * logger tagged with its id, the shared event bus, its own storage namespace,
 * and the service registry. It uses ordinary imports for everything else.
 *
 * See first-party.ts for why membership in this tier cannot be self-declared.
 */

import { pluginLogger } from "../utils/logger.js";
import { pluginEvents } from "./events.js";
import * as registry from "./registry.js";
import * as serviceRegistry from "./service-registry.js";
import type { ServiceRegistration } from "./service-registry.js";
import * as secretRegistry from "./secret-registry.js";
import type { SecretRegistration } from "./secret-registry.js";
import { safeDetails } from "./broker.js";
import type { PluginManifest } from "./manifest.js";

export interface InProcessPluginContext {
  pluginId: string;
  manifest: PluginManifest;
  log: {
    debug: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string, error?: Error) => void;
  };
  events: {
    emit: (topic: string, payload: unknown) => void;
    on: (topic: string, listener: (payload: unknown) => void) => () => void;
  };
  storage: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<boolean>;
    list: () => Promise<string[]>;
  };
  registry: {
    provide: <T>(key: string, value: T) => void;
    consume: <T>(key: string) => T | undefined;
    revoke: (key: string, value?: unknown) => boolean;
  };
  /**
   * Declared service contracts between plugins. Unlike `registry` above, a
   * service must be declared in the manifest and every call through a handle
   * is checked against the acting user's role permissions.
   */
  services: {
    provide: <T extends object>(service: string, implementation: T) => void;
    get: <T extends object>(
      service: string,
      options?: { userId?: string },
    ) => T;
  };
  /**
   * Secrets shared between plugins by reference.
   *
   * `offer` publishes a resolver, never a value, so the provider keeps the
   * ability to rotate or clear it at any time. `getShared` reads another
   * plugin's offered secret for one call, gated by that provider's own role
   * permission. See secret-registry.ts.
   */
  secrets: {
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
  };
}

/**
 * Tracks what a plugin registered so deactivate can undo it. A first-party
 * plugin owns real resources -- a listening port, live SSH sessions -- so
 * "disabled" has to actually release them, not just stop routing to them.
 */
export interface InProcessHandle {
  module: PluginModule;
  /** Event unsubscribers, run on deactivate so no listener outlives the plugin. */
  unsubscribers: Array<() => void>;
  /** Registry keys this plugin provided, revoked on deactivate. */
  providedKeys: Array<{ key: string; value: unknown }>;
  /** Declared services this plugin provided, revoked on deactivate. */
  providedServices: ServiceRegistration[];
  /** Shared secrets this plugin offered, withdrawn on deactivate. */
  offeredSecrets: SecretRegistration[];
}

export interface PluginModule {
  activate: (ctx: InProcessPluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

export function createInProcessContext(
  manifest: PluginManifest,
  handle: InProcessHandle,
): InProcessPluginContext {
  const pluginId = manifest.id;
  // Forced, like the worker path: a plugin cannot log as another plugin.
  const context = { operation: `plugin:${pluginId}` };

  return {
    pluginId,
    manifest,

    log: {
      debug: (message) => pluginLogger.debug(message, context),
      info: (message) => pluginLogger.info(message, context),
      warn: (message) => pluginLogger.warn(message, context),
      error: (message, error) => pluginLogger.error(message, error, context),
    },

    events: {
      emit: (topic, payload) => pluginEvents.emit(topic, payload),
      on: (topic, listener) => {
        const unsubscribe = pluginEvents.on(topic, listener);
        handle.unsubscribers.push(unsubscribe);
        return unsubscribe;
      },
    },

    storage: {
      get: async (key) => {
        const { createCurrentPluginStorageRepository } =
          await import("../database/repositories/factory.js");
        const raw = await createCurrentPluginStorageRepository().get(
          pluginId,
          key,
        );
        if (raw === null) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      },
      set: async (key, value) => {
        const { createCurrentPluginStorageRepository } =
          await import("../database/repositories/factory.js");
        await createCurrentPluginStorageRepository().set(
          pluginId,
          key,
          JSON.stringify(value ?? null),
        );
      },
      delete: async (key) => {
        const { createCurrentPluginStorageRepository } =
          await import("../database/repositories/factory.js");
        return createCurrentPluginStorageRepository().delete(pluginId, key);
      },
      list: async () => {
        const { createCurrentPluginStorageRepository } =
          await import("../database/repositories/factory.js");
        return createCurrentPluginStorageRepository().listKeys(pluginId);
      },
    },

    registry: {
      provide: (key, value) => {
        registry.provide(key, value);
        handle.providedKeys.push({ key, value });
      },
      consume: (key) => registry.consume(key),
      revoke: (key, value) => registry.revoke(key, value),
    },

    services: {
      provide: (service, implementation) => {
        // Declared AND provided, the same shape the capability gate uses: a
        // plugin cannot publish a service its manifest never mentioned.
        const declared = manifest.provides?.find(
          (entry) => entry.service === service,
        );
        if (!declared) {
          throw new Error(
            `Plugin ${pluginId} cannot provide service "${service}": it is not declared in the manifest's provides array`,
          );
        }

        const registration = serviceRegistry.provideService({
          service,
          version: declared.version,
          permission: declared.permission,
          pluginId,
          pluginName: manifest.name,
          implementation: implementation as Record<string, unknown>,
        });
        handle.providedServices.push(registration);
      },

      get: (service, options) =>
        serviceRegistry.createServiceHandle(service, pluginId, {
          resolveUserId: () => options?.userId,
          hasPermission: checkPermission,
          audit: (entry) => writeServiceAudit(entry),
        }),
    },

    secrets: {
      offer: (key, resolve) => {
        // Declared AND offered, the same rule services.provide enforces.
        const declared = manifest.providesSecret?.find(
          (entry) => entry.key === key,
        );
        if (!declared) {
          throw new Error(
            `Plugin ${pluginId} cannot offer secret "${key}": it is not declared in the manifest's providesSecret array`,
          );
        }

        const registration = secretRegistry.offerSecret({
          pluginId,
          pluginName: manifest.name,
          key,
          permission: declared.permission,
          resolve,
        });
        handle.offeredSecrets.push(registration);
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
          resolveUserId: () => options?.userId,
          hasPermission: checkPermission,
          audit: (entry) => writeSecretAudit(entry),
        }),
    },
  };
}

async function checkPermission(
  userId: string,
  permission: string,
): Promise<boolean> {
  const { PermissionManager } = await import("../utils/permission-manager.js");
  return PermissionManager.getInstance().hasPermission(userId, permission);
}

/**
 * Mirrors PluginBroker.audit: attribution comes from the runtime, never from
 * the plugin, and the details only ever record the shape of a call.
 */
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
      details: safeDetails(
        `${entry.registration.service}.${entry.method}`,
        entry.args,
      ),
      success: entry.success,
      errorMessage: entry.errorMessage,
    });
  } catch {
    // Auditing must never break the caller.
  }
}

/**
 * Records that a secret was borrowed, never what it was.
 *
 * `resolved` is the only thing said about the value: whether one came back at
 * all. That is what makes the trail useful (you can see a consumer running on
 * someone else's key) without the trail itself becoming a place the secret
 * leaks to.
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

/** Undoes everything the ctx handed out. Safe to call more than once. */
export async function disposeInProcessHandle(
  handle: InProcessHandle,
  pluginId: string,
): Promise<void> {
  for (const { key, value } of handle.providedKeys) {
    registry.revoke(key, value);
  }
  handle.providedKeys = [];

  // Taking the services with it is what makes a consumer's held handle start
  // throwing PluginServiceUnavailableError rather than calling a dead provider.
  for (const registration of handle.providedServices) {
    serviceRegistry.revokeService(registration.service, registration);
  }
  handle.providedServices = [];

  // Withdrawing the offers is what turns a borrower's getShared into a plain
  // null instead of a handle pointing at a resolver whose plugin is gone. The
  // sweep afterwards is belt and braces: an offer made outside the ctx, or one
  // whose push was lost to a crash mid-activate, would otherwise outlive the
  // plugin that backs it.
  for (const registration of handle.offeredSecrets) {
    secretRegistry.withdrawSecret(
      registration.pluginId,
      registration.key,
      registration,
    );
  }
  handle.offeredSecrets = [];
  secretRegistry.withdrawAllForPlugin(pluginId);

  for (const unsubscribe of handle.unsubscribers) {
    try {
      unsubscribe();
    } catch {
      // Already detached.
    }
  }
  handle.unsubscribers = [];

  // The plugin's own cleanup runs last: it may still want to emit or read
  // while shutting down.
  if (typeof handle.module.deactivate === "function") {
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
