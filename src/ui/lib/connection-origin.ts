import { isElectron } from "@/lib/electron";
import { websocketAuthProtocols } from "@/lib/ws-auth";

export type ConnectionOrigin = "local" | "remote";

interface OriginResolvableHost {
  connectionType?: string | null;
  connectionOrigin?: ConnectionOrigin | null;
}

const GUACAMOLE_CONNECTION_TYPES = new Set(["rdp", "vnc", "telnet"]);

/**
 * Resolves which backend a given host's interactive connection (SSH,
 * Docker console, Serial, RDP/VNC/Telnet) should dial: the desktop app's
 * embedded local backend, or a connected remote sync server.
 *
 * Serial always resolves to "local" -- the hardware is physically attached
 * to this desktop machine. Everything else follows the host's own override
 * if set, falling back to the desktop-wide default.
 *
 * RDP/VNC/Telnet are the exception to that fallback: left on Default they
 * resolve to "remote" rather than following the desktop-wide setting. They
 * need a guacd, which the desktop does not ship, so originating them here
 * only works once the user has pointed Termix at one of their own (the
 * global guacd URL setting, or a host's guacd Proxy override). Making that
 * opt-in per host keeps an upgrade from moving working connections onto a
 * guacd that isn't there -- see Termix-SSH/Support#1240.
 */
export async function resolveConnectionOrigin(
  host: OriginResolvableHost,
): Promise<ConnectionOrigin> {
  if (host.connectionType === "serial") {
    return "local";
  }
  if (!isElectron()) {
    return "local";
  }
  if (host.connectionOrigin === "local" || host.connectionOrigin === "remote") {
    return host.connectionOrigin;
  }
  if (GUACAMOLE_CONNECTION_TYPES.has(host.connectionType ?? "")) {
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
  try {
    const [config, jwt] = await Promise.all([
      window.electronAPI?.invoke?.("get-remote-sync-config") as Promise<{
        serverUrl?: string;
      } | null>,
      window.electronAPI?.invoke?.("get-remote-sync-jwt") as Promise<
        string | null
      >,
    ]);
    if (!config?.serverUrl) return null;
    return { serverUrl: config.serverUrl, jwt: jwt ?? null };
  } catch {
    return null;
  }
}

/**
 * Builds the base WebSocket URL for an interactive connection protocol,
 * given a resolved origin. Returns null when origin is "remote" but no
 * remote server is connected -- callers must show a blocking message
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
