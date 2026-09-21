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
  };
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
