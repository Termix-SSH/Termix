import type { PluginContext } from "@termix/plugin-sdk/backend";
import { startFleetsService, stopFleetsService } from "./routes.js";

export async function activate(ctx: PluginContext) {
  startFleetsService();
  ctx.log.info("Fleets router registered at /fleets");
}

export async function deactivate() {
  stopFleetsService();
}
