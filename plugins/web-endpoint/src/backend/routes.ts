import express, { type Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  parseWebUiConfig,
  type WebEndpoint,
} from "../shared/web-endpoint-config.js";

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

async function loadEndpoint(
  ctx: PluginContext,
  hostId: number,
  endpointId: string,
): Promise<
  { error: { status: number; message: string } } | { endpoint: WebEndpoint }
> {
  const host = await ctx.hosts.get(hostId);
  if (!host) {
    return {
      error: { status: 403, message: "Host not found or access denied" },
    };
  }

  // A bulk update that only flips enableWebUi off can leave stale endpoints
  // in webUiConfig. The UI reads as off in that state, so a listed endpoint
  // is not on its own a licence to open a tunnel.
  const enabled = await ctx.settings.getHost<boolean>(hostId, "enableWebUi");
  if (!enabled) {
    return {
      error: {
        status: 400,
        message: "Web endpoints are not enabled for this host",
      },
    };
  }

  // Re-normalized rather than trusted: the stored value predates any later
  // tightening of the rules, and this is the value a forward or a window is
  // built from.
  const rawConfig = await ctx.settings.getHost(hostId, "webUiConfig");
  const endpoint = parseWebUiConfig(rawConfig).endpoints.find(
    (candidate) => candidate.id === endpointId,
  );
  if (!endpoint) {
    return { error: { status: 400, message: "Web endpoint not found" } };
  }

  return { endpoint };
}

async function openTunnel(
  ctx: PluginContext,
  hostId: number,
  endpointId: string,
  endpoint: WebEndpoint,
): Promise<{ bindHost: string; bindPort: number }> {
  const userId = ctx.currentActor();
  let tunnels: TunnelsAccess;
  try {
    tunnels = ctx.services.get<TunnelsAccess>("tunnels.access", { userId });
  } catch {
    throw Object.assign(new Error("The tunnels plugin is not available"), {
      status: 503,
    });
  }

  try {
    return await tunnels.forward(
      hostId,
      {
        targetHost: "127.0.0.1",
        targetPort: endpoint.port,
        // Loopback unless the endpoint asks otherwise. A non-loopback bind
        // publishes the target's web UI to anyone who can reach the port,
        // with no authentication in front of it, and is only ever an
        // explicit per-endpoint choice.
        bindHost: endpoint.bindHost || "127.0.0.1",
        // A fixed port when the endpoint names one, since a container can
        // only publish ports it knows in advance. Otherwise the kernel picks.
        bindPort: endpoint.localPort ?? undefined,
      },
      {
        name: webEndpointTunnelName(hostId, endpointId),
        idleTimeoutMs: WEB_ENDPOINT_IDLE_TIMEOUT_MS,
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    ctx.log.error(
      `Failed to open web endpoint tunnel for host ${hostId}: ${reason}`,
      error instanceof Error ? error : undefined,
    );
    throw Object.assign(new Error(reason), { status: 502 });
  }
}

/** A bare IPv6 literal has to be bracketed to be a legal URL authority. */
function bracketIfIpv6(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function endpointUrl(
  hostAddress: string,
  endpoint: WebEndpoint,
  localPort?: number,
): string {
  const path = endpoint.path && endpoint.path.length > 0 ? endpoint.path : "/";
  if (endpoint.access === "tunnel") {
    // Electron's isolated window always dials the backend's own loopback,
    // exactly like the renderer's own currentTunnelHost(true) does.
    return `${endpoint.scheme}://127.0.0.1:${localPort}${path}`;
  }
  return `${endpoint.scheme}://${bracketIfIpv6(hostAddress)}:${endpoint.port}${path}`;
}

export function createWebEndpointRoutes(ctx: PluginContext): Router {
  const router = express.Router();

  router.post("/open", async (req, res) => {
    const userId = ctx.currentActor();
    if (!userId) {
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
    const resolved = await loadEndpoint(ctx, hostId, endpointId);
    if ("error" in resolved) {
      return res
        .status(resolved.error.status)
        .json({ error: resolved.error.message });
    }
    if (resolved.endpoint.access !== "tunnel") {
      return res
        .status(400)
        .json({ error: "This endpoint does not use a tunnel" });
    }

    try {
      const handle = await openTunnel(
        ctx,
        hostId,
        endpointId,
        resolved.endpoint,
      );
      return res.status(200).json({ port: handle.bindPort });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      const message = error instanceof Error ? error.message : String(error);
      return res.status(status).json({ error: message });
    }
  });

  /**
   * Opens the endpoint in an isolated Electron window instead of a tab.
   * Every part of the target URL is resolved server-side (the host's own
   * declared address for a direct endpoint, or the tunnel port this route
   * just opened for a tunnel one) so ctx.desktop.openIsolatedWindow's
   * capability check and audit line cover the whole decision, not just the
   * final "open a window" step.
   */
  router.post("/open-window", async (req, res) => {
    const userId = ctx.currentActor();
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { hostId, endpointId, ignoreCert } = req.body ?? {};
    if (
      !Number.isInteger(hostId) ||
      hostId < 1 ||
      typeof endpointId !== "string"
    ) {
      return res.status(400).json({ error: "Invalid web endpoint request" });
    }

    const resolved = await loadEndpoint(ctx, hostId, endpointId);
    if ("error" in resolved) {
      return res
        .status(resolved.error.status)
        .json({ error: resolved.error.message });
    }
    const { endpoint } = resolved;

    try {
      let localPort: number | undefined;
      if (endpoint.access === "tunnel") {
        const handle = await openTunnel(ctx, hostId, endpointId, endpoint);
        localPort = handle.bindPort;
      }

      const host = await ctx.hosts.get(hostId);
      if (!host) {
        return res
          .status(403)
          .json({ error: "Host not found or access denied" });
      }

      const url = endpointUrl(host.ip, endpoint, localPort);
      const result = await ctx.desktop.openIsolatedWindow({
        url,
        title: endpoint.label,
        ignoreCert: endpoint.access === "direct" && ignoreCert === true,
      });
      return res.status(200).json(result);
    } catch (error) {
      const status = (error as { status?: number }).status ?? 502;
      const message = error instanceof Error ? error.message : String(error);
      return res.status(status).json({ error: message });
    }
  });

  return router;
}
