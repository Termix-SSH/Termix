import type { PluginContext } from "@termix/plugin-sdk/backend";
import { startFleetsService, stopFleetsService } from "./routes.js";

export async function activate(ctx: PluginContext) {
  startFleetsService(ctx.http.router());
  ctx.log.info("Fleets routes mounted at /plugin-api/fleets");
}

export async function deactivate() {
  stopFleetsService();
}
