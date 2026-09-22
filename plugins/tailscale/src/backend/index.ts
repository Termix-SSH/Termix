import type { PluginContext } from "@termix/plugin-sdk/backend";
import { startTailscaleService, stopTailscaleService } from "./routes.js";

export async function activate(ctx: PluginContext) {
  startTailscaleService(ctx.http.router());
  ctx.log.info("Tailscale routes mounted at /plugin-api/tailscale");
}

export async function deactivate() {
  stopTailscaleService();
}
