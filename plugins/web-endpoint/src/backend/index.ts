import type { PluginContext } from "@termix/plugin-sdk/backend";
import { setPluginSsh } from "./ssh.js";
import { startWebEndpointService, stopWebEndpointService } from "./routes.js";

export async function activate(ctx: PluginContext) {
  setPluginSsh(ctx.ssh);
  ctx.disposables.add(() => setPluginSsh(null));
  startWebEndpointService(ctx.http.router());
  ctx.log.info("Web Endpoint routes mounted at /plugin-api/web-endpoint");
}

export async function deactivate() {
  stopWebEndpointService();
}
