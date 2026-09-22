import type { PluginContext } from "@termix/plugin-sdk/backend";
import { startAutomationsService, stopAutomationsService } from "./routes.js";
import {
  startAutomationScheduler,
  stopAutomationScheduler,
} from "./scheduler.js";

export async function activate(ctx: PluginContext) {
  startAutomationsService();
  startAutomationScheduler();
  ctx.log.info(
    "Automations router registered at /automations; scheduler started",
  );
}

export async function deactivate() {
  stopAutomationScheduler();
  stopAutomationsService();
}
