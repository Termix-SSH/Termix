import type { PluginContext } from "@termix/plugin-sdk/backend";
import { startWorkspacesService, stopWorkspacesService } from "./routes.js";

export async function activate(ctx: PluginContext) {
  startWorkspacesService(ctx.http.router());
  ctx.log.info("Workspaces routes mounted at /plugin-api/workspaces");
}

export async function deactivate() {
  stopWorkspacesService();
}
