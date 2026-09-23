import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { setPluginSsh } from "./ssh.js";
import { setPluginCtx } from "./plugin-ctx.js";
import { startProxmoxService, stopProxmoxService } from "./routes.js";
import {
  startProxmoxStatsService,
  stopProxmoxStatsService,
} from "./stats-service.js";
import { proxmoxNodeHistory } from "./tables.js";
import { createProxmoxNodeHistoryRepository } from "./proxmox-node-history-repository.js";

export async function activate(ctx: PluginContext) {
  setPluginSsh(ctx.ssh);
  setPluginCtx(ctx);
  ctx.disposables.add(() => setPluginSsh(null));
  ctx.disposables.add(() => setPluginCtx(null));

  const historyTable = await ctx.db.define(proxmoxNodeHistory);
  const historyRepository = createProxmoxNodeHistoryRepository(
    ctx.db,
    historyTable,
  );

  const router = ctx.http.router<Router>();
  startProxmoxService(router);
  ctx.disposables.add(stopProxmoxService);
  startProxmoxStatsService(ctx, router, historyRepository);
  ctx.disposables.add(stopProxmoxStatsService);
  ctx.log.info("Proxmox routes mounted at /plugin-api/proxmox");
}

export async function deactivate() {
  stopProxmoxService();
  stopProxmoxStatsService();
}
