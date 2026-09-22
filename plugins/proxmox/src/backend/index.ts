import type { PluginContext } from "@termix/plugin-sdk/backend";
import { startProxmoxService, stopProxmoxService } from "./routes.js";

export async function activate(ctx: PluginContext) {
  startProxmoxService(ctx.http.router());
  ctx.log.info("Proxmox routes mounted at /plugin-api/proxmox");
}

export async function deactivate() {
  stopProxmoxService();
}
