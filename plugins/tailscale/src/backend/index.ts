import type { PluginContext } from "@termix/plugin-sdk/backend";
import { startTailscaleService, stopTailscaleService } from "./routes.js";

export async function activate(ctx: PluginContext) {
  startTailscaleService();
  ctx.log.info("Tailscale router registered at /tailscale");
}

export async function deactivate() {
  stopTailscaleService();
}
