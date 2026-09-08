import type express from "express";
import { Client } from "ssh2";
import { AuthManager } from "../../utils/auth-manager.js";
import { tunnelLogger } from "../../utils/logger.js";
import { parseWebUiConfig } from "../../database/routes/host-web-endpoints.js";
import {
  activeTunnelRuntimes,
  cleanupTunnelResources,
  connectSSHTunnel,
  connectionStatus,
  tunnelConnecting,
} from "./manager.js";
import { forwardOut } from "./ssh-primitives.js";
import { buildWebEndpointTunnelName } from "./utils.js";
import type { TunnelConfig, WebEndpoint } from "../../../types/index.js";

/** Matches the spec's ten minutes. */
const WEB_ENDPOINT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Long enough for a slow SSH handshake, short enough that a wedged connection
 * does not hold the HTTP request open indefinitely. One second past the
 * manager's own connection timeout so the manager reports first.
 */
const TUNNEL_READY_TIMEOUT_MS = 61_000;
const TUNNEL_READY_POLL_MS = 100;
const TARGET_PROBE_TIMEOUT_MS = 10_000;

/**
 * What the live forward was built for. Compared on reuse so an endpoint edited
 * under a live tunnel is reopened rather than silently forwarding to the old
 * target.
 *
 * JSON rather than a joined string: no separator can be smuggled in by a field
 * value, and the result stays readable in a log. The SSH identity is included
 * because a host repointed at a different server must also invalidate the
 * forward, not just a changed endpoint port.
 */
function targetFingerprint(
  endpoint: Pick<
    WebEndpoint,
    "scheme" | "port" | "access" | "bindHost" | "localPort"
  >,
  host: { ip?: string; port?: number; username?: string },
): string {
  return JSON.stringify({
    scheme: endpoint.scheme,
    port: endpoint.port,
    access: endpoint.access,
    bindHost: endpoint.bindHost ?? null,
    localPort: endpoint.localPort ?? null,
    ip: host.ip ?? null,
    sshPort: host.port ?? null,
    username: host.username ?? null,
  });
}

const openedTargets = new Map<string, string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * connectSSHTunnel(config) returns Promise<void> and NEVER REJECTS: every
 * failure path inside it reports over broadcastTunnelStatus and returns
 * normally, and its own promise resolves right after conn.connect(), long
 * before the SSH "ready" event that would populate activeTunnelRuntimes.
 *
 * So "awaited" is not "connected". This is what actually waits.
 *
 * Polling the maps the manager already exports, rather than adding a
 * promise-returning variant to manager.ts: every existing caller of
 * connectSSHTunnel is fire-and-forget by design (the connect route responds
 * "Connection request received" immediately and reports asynchronously over
 * the status broadcast), so changing that contract to serve one new caller is
 * a far larger blast radius than polling here.
 */
async function waitForTunnelSettled(tunnelName: string): Promise<void> {
  const deadline = Date.now() + TUNNEL_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (activeTunnelRuntimes.has(tunnelName)) return;

    const status = connectionStatus.get(tunnelName);
    if (!tunnelConnecting.has(tunnelName) && status && !status.connected) {
      throw new Error(status.reason || "The endpoint tunnel failed to connect");
    }
    await sleep(TUNNEL_READY_POLL_MS);
  }

  throw new Error("Timed out establishing the endpoint tunnel");
}

/**
 * Opens one channel to the target and closes it immediately.
 *
 * Without this the route returns 200 the moment tcpServer.listen succeeds, and
 * forwardOut is only attempted per inbound socket -- where a failure is
 * swallowed by the socket's own error handling. The user then gets a blank
 * frame and no message for the single likeliest error: nothing is actually
 * listening on that port. Costs one round trip per open.
 */
async function probeEndpointTarget(
  sourceClient: Client,
  targetPort: number,
  tunnelName: string,
): Promise<void> {
  const channel = await Promise.race([
    forwardOut(sourceClient, "127.0.0.1", targetPort, tunnelName),
    new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error("Timed out reaching the endpoint port")),
        TARGET_PROBE_TIMEOUT_MS,
      ),
    ),
  ]);
  try {
    channel.end();
  } catch {
    // Already gone; the probe succeeded either way.
  }
}

export async function handleWebEndpointOpen(
  req: express.Request,
  res: express.Response,
): Promise<express.Response | void> {
  const userId = (req as { userId?: string }).userId;
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
  // backend runs, exactly as the server tunnels feature does, and the
  // endpoint's own bindHost decides whether that is reachable from the
  // browser -- loopback for the desktop, an address the server answers on for
  // a web deployment.

  const { resolveHostById } = await import("../host-resolver.js");
  const host = await resolveHostById(hostId, userId);
  if (!host) {
    return res.status(403).json({ error: "Host not found or access denied" });
  }

  // All three write paths null the config on disable, so a configured-but-
  // disabled host is not normally reachable -- except a bulk update that sends
  // only { webUiConfig } while the stored enable_web_ui is still 0. The UI
  // reads as off everywhere in that state, so the endpoint merely being
  // present in the config is not on its own a licence to open a tunnel.
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

  const tunnelName = buildWebEndpointTunnelName(hostId, endpointId);
  const fingerprint = targetFingerprint(endpoint, host);
  const existing = activeTunnelRuntimes.get(tunnelName);

  if (existing) {
    const recorded = openedTargets.get(tunnelName);
    // The runtime is the source of truth and openedTargets is derived from it,
    // so an ABSENT fingerprint means reuse, not staleness. A reserved-prefixed
    // runtime can only have been created by this route.
    if (recorded === undefined || recorded === fingerprint) {
      openedTargets.set(tunnelName, fingerprint);
      return res.status(200).json({ port: existing.bindPort });
    }

    tunnelLogger.info("Reopening web endpoint tunnel after config change", {
      operation: "web_endpoint_reopen",
      tunnelName,
    });
    // Forced, for the same reason handleDisconnect's reserved-name branch
    // forces: cleanupTunnelResources no-ops while tunnelConnecting holds the
    // name, and a web tunnel has no retry pass to self-heal a runtime left
    // behind. An unforced call could leave a dead listener registered.
    await cleanupTunnelResources(tunnelName, true);
    openedTargets.delete(tunnelName);
  }

  const tunnelConfig: TunnelConfig = {
    name: tunnelName,
    scope: "s2s",
    mode: "local",
    tunnelType: "local",
    // Loopback unless the endpoint asks otherwise. A non-loopback bind
    // publishes the target's web UI to anyone who can reach the port, with no
    // authentication in front of it -- the same trade the server tunnels
    // feature exposes, and only ever an explicit per-endpoint choice. The
    // value is validated to a bare host literal by normalizeBindHost.
    bindHost: endpoint.bindHost || "127.0.0.1",
    sourceHostId: host.id ?? hostId,
    tunnelIndex: 0,
    requestingUserId: userId,
    hostName: host.name || `${host.username}@${host.ip}`,
    sourceIP: host.ip,
    sourceSSHPort: host.port,
    sourceUsername: host.username,
    sourcePassword: host.password,
    sourceAuthMethod: host.authType,
    sourceSSHKey: host.key,
    sourceKeyPassword: host.keyPassword,
    sourceKeyType: host.keyType,
    sourceCredentialId: host.credentialId,
    // connectSSHTunnel reads sourceUserId when building its client.
    sourceUserId: host.userId,
    endpointIP: host.ip,
    endpointSSHPort: host.port,
    endpointUsername: host.username,
    // Load-bearing: connectSSHTunnel picks its strategy via
    // shouldEstablishDirectTunnel -> isSingleHostTunnel, which returns true
    // when endpointHost is "127.0.0.1". That is what selects
    // establishDirectTunnel's local branch -- the bind-locally-and-forwardOut
    // path this feature needs. Setting only targetHost would NOT select it.
    endpointHost: "127.0.0.1",
    endpointAuthMethod: host.authType,
    endpointSSHKey: host.key,
    endpointKeyPassword: host.keyPassword,
    endpointKeyType: host.keyType,
    endpointCredentialId: host.credentialId,
    endpointUserId: host.userId,
    // A fixed port when the endpoint names one, as the server tunnels
    // feature's Source Port does -- a container can only publish ports it
    // knows in advance. Otherwise 0 and the kernel picks; the manager reports
    // back what it actually bound either way.
    sourcePort: endpoint.localPort ?? 0,
    endpointPort: endpoint.port,
    // Documentation only: maxRetries 0 does NOT disable retries, because the
    // manager reads `maxRetries || 3`. Retry is actually suppressed by the
    // reserved-name early return in handleDisconnect.
    maxRetries: 0,
    retryInterval: 0,
    autoStart: false,
    isPinned: Boolean(host.pin),
    idleTimeoutMs: WEB_ENDPOINT_IDLE_TIMEOUT_MS,
    useSocks5: Boolean(host.useSocks5),
    socks5Host: host.socks5Host,
    socks5Port: host.socks5Port,
    socks5Username: host.socks5Username,
    socks5Password: host.socks5Password,
    socks5ProxyChain: host.socks5ProxyChain,
  } as TunnelConfig;

  try {
    await connectSSHTunnel(tunnelConfig);
    await waitForTunnelSettled(tunnelName);

    const runtime = activeTunnelRuntimes.get(tunnelName);
    if (!runtime) {
      throw new Error("The endpoint tunnel closed before it could be used");
    }

    await probeEndpointTarget(runtime.sourceClient, endpoint.port, tunnelName);

    openedTargets.set(tunnelName, fingerprint);
    return res.status(200).json({ port: runtime.bindPort });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    tunnelLogger.error("Failed to open web endpoint tunnel", error, {
      operation: "web_endpoint_open_failed",
      tunnelName,
    });
    // Leave nothing half-built: a listener with no working forward behind it
    // would be handed out on the next open as a live tunnel.
    await cleanupTunnelResources(tunnelName, true).catch(() => undefined);
    openedTargets.delete(tunnelName);
    return res.status(502).json({ error: reason });
  }
}

export function registerWebEndpointRoutes(app: express.Express): void {
  // Constructed here rather than at module scope so importing this module for
  // a handler unit test does not construct the auth singleton.
  const authenticateJWT = AuthManager.getInstance().createAuthMiddleware();
  app.post("/tunnel/web-endpoint/open", authenticateJWT, handleWebEndpointOpen);
}
