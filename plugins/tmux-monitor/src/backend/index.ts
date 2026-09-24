import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { sessionTags } from "./tables.js";
import { createSessionTagRepository } from "./repository.js";
import { createTmuxMonitorRoutes } from "./routes.js";
import { createTmuxSessionsService } from "./service.js";

export type { TmuxDetection, TmuxSessionsV1 } from "./service.js";

export async function activate(ctx: PluginContext) {
  const table = await ctx.db.define(sessionTags);
  const tags = createSessionTagRepository(ctx.db, table);

  ctx.http.router<Router>().use(createTmuxMonitorRoutes(ctx, tags));

  ctx.services.provide("tmux.sessions", createTmuxSessionsService(ctx));

  ctx.log.info("Tmux Monitor routes mounted at /plugin-api/tmux-monitor");
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
