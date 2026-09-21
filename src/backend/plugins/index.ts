/**
 * Composition root for the plugin runtime: wires the loader, the broker and the
 * /plugin-api dispatcher together and exposes the handful of calls the rest of
 * the server needs.
 *
 * The heavy dependencies (host resolution, the SSH pool, the repositories) are
 * imported lazily inside the dep functions rather than at module scope. Several
 * of them pull in the repository layer, and a static import here would create
 * the same cycle hosts/automation-events.ts documents.
 */

import { pluginLogger } from "../utils/logger.js";
import {
  registerPluginRouter,
  unregisterPluginRouter,
} from "../database/routes/plugin-api-routes.js";
import { PluginBroker, type PluginRuntime } from "./broker.js";
import { buildPluginRouter } from "./http-bridge.js";
import { PluginLoader, type LoadedPlugin } from "./loader.js";

let loader: PluginLoader | null = null;
let broker: PluginBroker | null = null;

function createBroker(): PluginBroker {
  return new PluginBroker({
    listHosts: async (userId) => {
      const { createCurrentHostRepository } =
        await import("../database/repositories/factory.js");
      // listByUserId, not listDecryptedByUserId: a plugin only ever gets host
      // metadata, so there is no reason to decrypt secrets just to drop them.
      const hosts = await createCurrentHostRepository().listByUserId(userId);
      return hosts as unknown as Record<string, unknown>[];
    },

    resolveHost: async (hostId, userId) => {
      // resolveHostById is the access gate and the decryption step in one. The
      // object it returns carries plaintext secrets, so it must never leave
      // this closure -- the broker maps it through toPluginHostView first.
      const { resolveHostById } = await import("../hosts/host-resolver.js");
      const host = await resolveHostById(hostId, userId);
      return host as unknown as Record<string, unknown> | null;
    },

    storage: {
      get: async (pluginId, key) => {
        const { createCurrentPluginStorageRepository } =
          await import("../database/repositories/factory.js");
        return createCurrentPluginStorageRepository().get(pluginId, key);
      },
      set: async (pluginId, key, value) => {
        const { createCurrentPluginStorageRepository } =
          await import("../database/repositories/factory.js");
        await createCurrentPluginStorageRepository().set(pluginId, key, value);
      },
      delete: async (pluginId, key) => {
        const { createCurrentPluginStorageRepository } =
          await import("../database/repositories/factory.js");
        return createCurrentPluginStorageRepository().delete(pluginId, key);
      },
      listKeys: async (pluginId) => {
        const { createCurrentPluginStorageRepository } =
          await import("../database/repositories/factory.js");
        return createCurrentPluginStorageRepository().listKeys(pluginId);
      },
    },

    ssh: {
      /**
       * The single most security-sensitive function in the plugin runtime.
       *
       * `host` below is the object resolveHostById returns: it carries the
       * plaintext password, private key and key passphrase. It is a local
       * inside this closure and is referenced only by createFleetSshFactory.
       * Nothing derived from it is returned. The caller gets two closures --
       * release and exec -- and exec resolves to stdout/stderr/code strings
       * only, so there is no path from the worker back to the credential.
       */
      open: async (hostId, userId) => {
        const [
          { resolveHostById },
          { connectionPool },
          { createFleetSshFactory, getFleetPoolKey },
          { execCommand },
        ] = await Promise.all([
          import("../hosts/host-resolver.js"),
          import("../hosts/ssh-connection-pool.js"),
          import("../hosts/ssh-client-factory.js"),
          import("../hosts/metrics/widgets/common-utils.js"),
        ]);

        // resolveHostById performs the RBAC check (canAccessHost) and returns
        // null for both "missing" and "forbidden".
        const host = await resolveHostById(hostId, userId);
        if (!host) {
          throw new Error(`Host ${hostId} not found or not accessible`);
        }

        const poolKey = getFleetPoolKey(host);
        const client = await connectionPool.getConnection(
          poolKey,
          createFleetSshFactory(host),
        );

        return {
          release: () => connectionPool.releaseConnection(poolKey, client),
          exec: (command, timeoutMs) => execCommand(client, command, timeoutMs),
        };
      },
    },

    onRoutesChanged: (runtime) => remountRoutes(runtime),
  });
}

function remountRoutes(runtime: PluginRuntime): void {
  if (runtime.routes.length === 0) return;
  registerPluginRouter(runtime.plugin.id, buildPluginRouter(broker!, runtime));
}

export function getPluginRuntime(): {
  loader: PluginLoader;
  broker: PluginBroker;
} {
  if (!loader || !broker) {
    broker = createBroker();
    loader = new PluginLoader({
      onWorkerReady: (plugin, worker) => broker!.attach(plugin, worker),
      onWorkerGone: (plugin) => {
        broker!.detach(plugin.id);
        unregisterPluginRouter(plugin.id);
      },
    });
  }
  return { loader, broker };
}

/**
 * Loads every plugin on disk and activates the ones marked enabled in the
 * database. Called once from the backend start-up sequence.
 */
export async function initializePlugins(): Promise<LoadedPlugin[]> {
  const { loader: pluginLoader } = getPluginRuntime();

  const loaded = await pluginLoader.loadAll();
  if (loaded.length === 0) return [];

  const {
    createCurrentPluginRepository,
    createCurrentPluginPermissionGrantRepository,
  } = await import("../database/repositories/factory.js");

  const records = await createCurrentPluginRepository().listAll();
  const byId = new Map(records.map((record) => [record.id, record]));

  for (const plugin of loaded) {
    const record = byId.get(plugin.id);
    if (!record || record.state !== "enabled") continue;

    // The plugins table records no installer, so the plugin acts under the
    // authority of whoever granted its capabilities. Without a grant there is
    // no owner and nothing the plugin could do with one, so it stays stopped.
    const grants =
      await createCurrentPluginPermissionGrantRepository().listByPlugin(
        plugin.id,
      );
    const ownerUserId = grants[0]?.grantedBy;

    if (!ownerUserId) {
      pluginLogger.warn(
        `Plugin ${plugin.id} is enabled but has no capability grants, leaving it stopped`,
        { operation: "plugin_activate" },
      );
      continue;
    }

    try {
      await activatePlugin(plugin.id, ownerUserId);
    } catch (error) {
      pluginLogger.error(
        `Failed to activate plugin ${plugin.id}`,
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_activate" },
      );
    }
  }

  return loaded;
}

export async function activatePlugin(
  pluginId: string,
  ownerUserId: string,
): Promise<void> {
  const { loader: pluginLoader, broker: pluginBroker } = getPluginRuntime();
  await pluginLoader.activate(pluginId, ownerUserId);

  const runtime = pluginBroker.get(pluginId);
  if (runtime) remountRoutes(runtime);
}

export async function deactivatePlugin(pluginId: string): Promise<void> {
  const { loader: pluginLoader } = getPluginRuntime();
  await pluginLoader.deactivate(pluginId);
  unregisterPluginRouter(pluginId);
}

export async function shutdownPlugins(): Promise<void> {
  if (!loader) return;
  for (const plugin of loader.list()) unregisterPluginRouter(plugin.id);
  await loader.shutdown();
}
