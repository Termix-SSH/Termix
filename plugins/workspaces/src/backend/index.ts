import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { workspaces } from "./tables.js";
import { createWorkspaceRepository } from "./repository.js";
import { registerWorkspaceRoutes } from "./routes.js";

/** What other plugins get from ctx.services.get("workspaces.saved"). */
export interface WorkspacesService {
  /** The calling user's workspaces, without their layouts. */
  list: () => Promise<Array<{ id: number; name: string; isDefault: boolean }>>;
}

export async function activate(ctx: PluginContext) {
  const table = await ctx.db.define(workspaces);
  const repo = createWorkspaceRepository(ctx.db, table);

  registerWorkspaceRoutes(ctx.http.router<Router>(), repo, ctx);

  // The last_session row belongs to one install. Syncing it would leave the
  // user with two, one from each side.
  ctx.sync.registerEntity({
    type: "workspaces",
    table,
    order: 200,
    shouldSync: (row) => row.kind !== "last_session",
  });

  const service: WorkspacesService = {
    list: async () => {
      const userId = ctx.currentActor();
      if (!userId) return [];
      const rows = await repo.listByUser(userId);
      return rows
        .filter((row) => row.kind === "manual")
        .map((row) => ({
          id: row.id,
          name: row.name,
          isDefault: !!row.isDefault,
        }));
    },
  };
  ctx.services.provide("workspaces.saved", service);

  ctx.log.info("Workspaces routes mounted at /plugin-api/workspaces");
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
