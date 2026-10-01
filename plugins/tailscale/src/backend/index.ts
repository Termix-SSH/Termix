import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { startTailscaleService, stopTailscaleService } from "./routes.js";
import { registerTailscaleSshAuth } from "./ssh-auth-provider.js";
import { registerTailscaleHostMetricsManager } from "./host-metrics-manager.js";
import { setPluginSsh } from "./ssh.js";

export async function activate(ctx: PluginContext) {
  const router = ctx.http.router<Router>();
  startTailscaleService(router, ctx);
  registerTailscaleHostMetricsManager(router, ctx);
  setPluginSsh(ctx.ssh);
  registerTailscaleSshAuth(ctx);
  ctx.log.info("Tailscale routes mounted at /plugin-api/tailscale");
}

export async function deactivate() {
  setPluginSsh(null);
  stopTailscaleService();
}
