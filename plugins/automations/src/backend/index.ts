import type { PluginContext } from "@termix/plugin-sdk/backend";
import { setPluginSsh } from "./ssh.js";
import { setPluginServices } from "./snippets.js";
import { setTunnelServices } from "./tunnels.js";
import { setDockerServices } from "./docker.js";
import { startAutomationsService, stopAutomationsService } from "./routes.js";
import {
  startAutomationScheduler,
  stopAutomationScheduler,
} from "./scheduler.js";
import { onInternalEvent } from "./triggers.js";

/** What the tunnels plugin emits when a tunnel drops without being asked to. */
interface TunnelDisconnectedEvent {
  userId?: string;
  hostId?: number;
  tunnelName?: string;
}

export async function activate(ctx: PluginContext) {
  setPluginSsh(ctx.ssh);
  ctx.disposables.add(() => setPluginSsh(null));
  setPluginServices(ctx.services);
  ctx.disposables.add(() => setPluginServices(null));
  setTunnelServices(ctx.services);
  ctx.disposables.add(() => setTunnelServices(null));
  setDockerServices(ctx.services);
  ctx.disposables.add(() => setDockerServices(null));

  // Nothing arrives here while the tunnels plugin is off, which is the whole
  // of the optional dependency.
  ctx.events.on("plugin.tunnels.tunnel_disconnected", (payload) => {
    const event = payload as TunnelDisconnectedEvent;
    if (!event?.userId) return;
    void onInternalEvent({
      event: "tunnel_disconnected",
      userId: event.userId,
      hostId: event.hostId,
      details: { tunnelName: event.tunnelName },
    }).catch((error: unknown) => {
      ctx.log.warn(
        `Tunnel disconnect trigger failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  });

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
