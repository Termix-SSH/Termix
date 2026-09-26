import { isElectron } from "@/lib/electron";
import { websocketAuthProtocols } from "@/lib/ws-auth";
import { getLinkedSession } from "@/lib/linked-server";

export type ConnectionOrigin = "local" | "remote";

interface OriginResolvableHost {
  connectionOrigin?: ConnectionOrigin | null;
}

/**
 * Resolves which backend a given host's interactive connection (SSH, Docker
 * console, RDP/VNC/Telnet) should dial: the desktop app's embedded local
 * backend, or the server it is linked to. A plugin whose connection is
 * always local regardless of this setting (serial: the hardware is
 * physically attached to this desktop machine) skips this helper entirely
 * and calls app.wsUrl() without an origin option, which defaults to "local".
 *
 * Everything else follows the host's own override if set, falling back to
 * the desktop-wide default.
 *
 * `defaultRemote` makes a host left on Default resolve to "remote" instead of
 * following the desktop-wide setting. Remote desktop passes it: it needs a
 * guacd, which the desktop does not ship, so originating it here only works
 * once the user has pointed Termix at one of their own. Making that opt-in
 * per host keeps an upgrade from moving working connections onto a guacd
 * that isn't there -- see Termix-SSH/Support#1240.
 */
export async function resolveConnectionOrigin(
  host: OriginResolvableHost,
  options: { defaultRemote?: boolean } = {},
): Promise<ConnectionOrigin> {
  if (!isElectron()) {
    return "local";
  }
  if (host.connectionOrigin === "local" || host.connectionOrigin === "remote") {
    return host.connectionOrigin;
  }
  if (options.defaultRemote) {
    return "remote";
  }

  try {
    const settings = (await window.electronAPI?.invoke?.(
      "get-desktop-settings",
    )) as { defaultConnectionOrigin?: ConnectionOrigin } | null;
    return settings?.defaultConnectionOrigin === "remote" ? "remote" : "local";
  } catch {
    return "local";
  }
}

export interface RemoteConnectionTarget {
  serverUrl: string;
  jwt: string | null;
}

async function getRemoteConnectionTarget(): Promise<RemoteConnectionTarget | null> {
  const linked = await getLinkedSession();
  return linked ? { serverUrl: linked.serverUrl, jwt: linked.token } : null;
}

/**
 * Builds the base WebSocket URL for an interactive connection protocol,
 * given a resolved origin. Returns null when origin is "remote" but this
 * desktop is not linked to a server -- callers must show a blocking message
 * rather than attempting to connect.
 */
export interface WebSocketConnectionTarget {
  url: string;
  protocols: string[];
}

export async function buildOriginWsUrl({
  origin,
  localPort,
  localPath,
  remotePath,
  includeJwt = true,
}: {
  origin: ConnectionOrigin;
  localPort: number;
  localPath: string;
  remotePath: string;
  includeJwt?: boolean;
}): Promise<WebSocketConnectionTarget | null> {
  if (origin === "local") {
    const token = includeJwt ? localStorage.getItem("jwt") : null;
    return {
      url: `ws://127.0.0.1:${localPort}${localPath}`,
      protocols: websocketAuthProtocols(token),
    };
  }

  const remote = await getRemoteConnectionTarget();
  if (!remote) return null;

  const wsProtocol = remote.serverUrl.startsWith("https://")
    ? "wss://"
    : "ws://";
  const wsHost = remote.serverUrl
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  return {
    url: `${wsProtocol}${wsHost}${remotePath}`,
    protocols: websocketAuthProtocols(includeJwt ? remote.jwt : null),
  };
}
