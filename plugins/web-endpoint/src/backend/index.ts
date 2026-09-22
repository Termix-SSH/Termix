import type { PluginContext } from "@termix/plugin-sdk/backend";
import { startWebEndpointService, stopWebEndpointService } from "./routes.js";

export async function activate(ctx: PluginContext) {
  startWebEndpointService();
  ctx.log.info("Web Endpoint router registered at /ssh/tunnel/web-endpoint");
}

export async function deactivate() {
  stopWebEndpointService();
}
