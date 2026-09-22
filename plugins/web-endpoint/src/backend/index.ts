import type { PluginContext } from "@termix/plugin-sdk/backend";
import { startWebEndpointService, stopWebEndpointService } from "./routes.js";

export async function activate(ctx: PluginContext) {
  startWebEndpointService(ctx.http.router());
  ctx.log.info("Web Endpoint routes mounted at /plugin-api/web-endpoint");
}

export async function deactivate() {
  stopWebEndpointService();
}
