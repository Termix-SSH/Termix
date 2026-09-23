import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { graphs } from "./tables.js";
import { createGraphRepository } from "./repository.js";
import { registerGraphRoutes } from "./routes.js";
import { mapTopologyHostIds } from "./topology-host-ids.js";

/** What other plugins get from ctx.services.get("network-topology.graph"). */
export interface NetworkTopologyService {
  /** The calling user's saved topology, or null if they have none. */
  get: () => Promise<unknown | null>;
}

export async function activate(ctx: PluginContext) {
  const table = await ctx.db.define(graphs);
  const repo = createGraphRepository(ctx.db, table);

  registerGraphRoutes(ctx.http.router<Router>(), repo, ctx);

  ctx.sync.registerEntity({
    type: "networkTopology",
    table,
    order: 100,
    singleton: true,
    // Host ids live inside the topology JSON rather than in a column, so the
    // generic reference machinery cannot reach them.
    serialize: async (row, resolveSyncId) => ({
      ...row,
      topology: await mapTopologyHostIds(
        row.topology as string | null | undefined,
        async (id) => {
          const numericId = Number(id);
          if (!Number.isInteger(numericId)) return null;
          return resolveSyncId("hosts", numericId);
        },
      ),
    }),
    deserialize: async (row, resolveId) => ({
      ...row,
      topology: await mapTopologyHostIds(
        row.topology as string | null | undefined,
        async (syncId) => {
          const id = await resolveId("hosts", syncId);
          return id === null ? null : String(id);
        },
      ),
    }),
  });

  const service: NetworkTopologyService = {
    get: async () => {
      const userId = ctx.currentActor();
      if (!userId) return null;
      const record = await repo.findByUserId(userId);
      if (!record?.topology) return null;
      try {
        return JSON.parse(record.topology);
      } catch {
        return null;
      }
    },
  };
  ctx.services.provide("network-topology.graph", service);

  ctx.log.info(
    "Network Topology routes mounted at /plugin-api/network-topology",
  );
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
