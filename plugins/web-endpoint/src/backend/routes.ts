import express, { type Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { parseWebUiConfig } from "../../../../src/backend/database/routes/host-web-endpoints.js";

/** Matches the spec's ten minutes. */
const WEB_ENDPOINT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** The tunnels plugin, as ctx.services.get("tunnels.access") returns it. */
interface TunnelsAccess {
  forward(
    sourceHostId: number,
    target: {
      targetHost: string;
      targetPort: number;
      bindHost?: string;
      bindPort?: number;
    },
    options?: { name?: string; idleTimeoutMs?: number },
  ): Promise<{ bindHost: string; bindPort: number }>;
}

/**
 * Reserved by the tunnels plugin for on-demand forwards: never retried, and
 * the host id in it is what the tunnels plugin checks before letting anyone
 * stop one by name.
 */
export function webEndpointTunnelName(
  hostId: number,
  endpointId: string,
): string {
  return `web:${hostId}:${endpointId}`;
}

let current: PluginContext | null = null;

export async function handleWebEndpointOpen(
  req: express.Request,
  res: express.Response,
): Promise<express.Response | void> {
  const ctx = current;
  const userId = ctx?.currentActor();
  if (!ctx || !userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const { hostId, endpointId } = req.body ?? {};
  if (
    !Number.isInteger(hostId) ||
    hostId < 1 ||
    typeof endpointId !== "string"
  ) {
    return res.status(400).json({ error: "Invalid web endpoint request" });
  }

  // Deliberately NOT gated to the desktop. The forward binds wherever this
  // backend runs, and the endpoint's own bindHost decides whether that is
  // reachable from the browser.

  const { resolveHostById } =
    await import("../../../../src/backend/hosts/host-resolver.js");
  const host = await resolveHostById(hostId, userId);
  if (!host) {
    return res.status(403).json({ error: "Host not found or access denied" });
  }

  // A bulk update that sends only { webUiConfig } can leave the endpoint in
  // the config while the feature is off. The UI reads as off in that state,
  // so the endpoint being listed is not on its own a licence to open a tunnel.
  if (!host.enableWebUi) {
    return res
      .status(400)
      .json({ error: "Web endpoints are not enabled for this host" });
  }

  // Re-normalized rather than trusted: the stored value predates any later
  // tightening of the rules, and this is the value a forward is built from.
  const endpoint = parseWebUiConfig(host.webUiConfig).endpoints.find(
    (candidate) => candidate.id === endpointId,
  );
  if (!endpoint) {
    return res.status(400).json({ error: "Web endpoint not found" });
  }
  if (endpoint.access !== "tunnel") {
    return res
      .status(400)
      .json({ error: "This endpoint does not use a tunnel" });
  }

  let tunnels: TunnelsAccess;
  try {
    tunnels = ctx.services.get<TunnelsAccess>("tunnels.access", { userId });
  } catch {
    return res
      .status(503)
      .json({ error: "The tunnels plugin is not available" });
  }

  try {
    const handle = await tunnels.forward(
      hostId,
      {
        targetHost: "127.0.0.1",
        targetPort: endpoint.port,
        // Loopback unless the endpoint asks otherwise. A non-loopback bind
        // publishes the target's web UI to anyone who can reach the port, with
        // no authentication in front of it, and is only ever an explicit
        // per-endpoint choice.
        bindHost: endpoint.bindHost || "127.0.0.1",
        // A fixed port when the endpoint names one, since a container can only
        // publish ports it knows in advance. Otherwise the kernel picks.
        bindPort: endpoint.localPort ?? undefined,
      },
      {
        name: webEndpointTunnelName(hostId, endpointId),
        idleTimeoutMs: WEB_ENDPOINT_IDLE_TIMEOUT_MS,
      },
    );
    return res.status(200).json({ port: handle.bindPort });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    ctx.log.error(
      `Failed to open web endpoint tunnel for host ${hostId}: ${reason}`,
      error instanceof Error ? error : undefined,
    );
    return res.status(502).json({ error: reason });
  }
}

export const router = express.Router();

let started = false;

export function startWebEndpointService(
  mountOn: Router,
  ctx: PluginContext,
): void {
  current = ctx;
  if (!started) {
    router.post("/open", handleWebEndpointOpen);
    started = true;
  }
  mountOn.use(router);
}

export function stopWebEndpointService(): void {
  current = null;
}
