import type { PluginContext } from "@termix/plugin-sdk/backend";
import { setPluginSsh } from "./ssh.js";
import { setPluginServices } from "./snippets.js";
import { startAutomationsService, stopAutomationsService } from "./routes.js";
import {
  startAutomationScheduler,
  stopAutomationScheduler,
} from "./scheduler.js";

export async function activate(ctx: PluginContext) {
  setPluginSsh(ctx.ssh);
  ctx.disposables.add(() => setPluginSsh(null));
  setPluginServices(ctx.services);
  ctx.disposables.add(() => setPluginServices(null));
  startAutomationsService(
    // The webhook route authenticates on its own per-automation token rather
    // than a session, which is the point of an inbound webhook.
    ctx.http.router({ public: ["/webhook/:token"] }),
  );
  startAutomationScheduler();
  ctx.log.info(
    "Automations routes mounted at /plugin-api/automations; scheduler started",
  );
}

export async function deactivate() {
  stopAutomationScheduler();
  stopAutomationsService();
}
