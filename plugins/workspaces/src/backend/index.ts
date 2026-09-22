import type { PluginContext } from "@termix/plugin-sdk/backend";
import { startWorkspacesService, stopWorkspacesService } from "./routes.js";

export async function activate(ctx: PluginContext) {
  startWorkspacesService();
  ctx.log.info("Workspaces router registered at /workspaces");
}

export async function deactivate() {
  stopWorkspacesService();
}
