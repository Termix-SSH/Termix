import type { PluginContext } from "@termix/plugin-sdk/backend";
import { setPluginSsh } from "./ssh.js";
import { startProxmoxService, stopProxmoxService } from "./routes.js";

export async function activate(ctx: PluginContext) {
  setPluginSsh(ctx.ssh);
  ctx.disposables.add(() => setPluginSsh(null));
  startProxmoxService(ctx.http.router());
  ctx.log.info("Proxmox routes mounted at /plugin-api/proxmox");
}

export async function deactivate() {
  stopProxmoxService();
}
