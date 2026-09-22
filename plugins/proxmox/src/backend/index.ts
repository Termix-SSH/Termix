import type { PluginContext } from "@termix/plugin-sdk/backend";
import { startProxmoxService, stopProxmoxService } from "./routes.js";

export async function activate(ctx: PluginContext) {
  startProxmoxService();
  ctx.log.info("Proxmox router registered at /proxmox");
}

export async function deactivate() {
  stopProxmoxService();
}
