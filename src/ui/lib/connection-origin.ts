import { isElectron } from "@/lib/electron";

export type ConnectionOrigin = "local" | "remote";

interface OriginResolvableHost {
  connectionType?: string | null;
  connectionOrigin?: ConnectionOrigin | null;
}

/**
 * Resolves which backend a given host's interactive connection (SSH,
 * Docker console, Serial) should dial: the desktop app's embedded local
 * backend, or a connected remote sync server.
 *
 * RDP/VNC/Telnet always resolve to "remote" -- guacd isn't bundled with the
 * embedded backend. Serial always resolves to "local" -- the hardware is
 * physically attached to this desktop machine. Everything else follows the
 * host's own override if set, falling back to the desktop-wide default.
 */
export async function resolveConnectionOrigin(
  host: OriginResolvableHost,
): Promise<ConnectionOrigin> {
  if (
    host.connectionType === "rdp" ||
    host.connectionType === "vnc" ||
    host.connectionType === "telnet"
  ) {
    return "remote";
  }
  if (host.connectionType === "serial") {
    return "local";
  }
  if (!isElectron()) {
    return "local";
  }
  if (host.connectionOrigin === "local" || host.connectionOrigin === "remote") {
    return host.connectionOrigin;
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
export async function buildOriginWsUrl({
  origin,
  localPort,
  localPath,
  remotePath,
  includeLocalJwt = true,
}: {
  origin: ConnectionOrigin;
  localPort: number;
  localPath: string;
  remotePath: string;
  includeLocalJwt?: boolean;
}): Promise<string | null> {
  if (origin === "local") {
    let url = `ws://127.0.0.1:${localPort}${localPath}`;
    if (includeLocalJwt) {
      const token = localStorage.getItem("jwt");
      if (token) url += `?token=${encodeURIComponent(token)}`;
    }
    return url;
  }

  const remote = await getRemoteConnectionTarget();
  if (!remote) return null;

  const wsProtocol = remote.serverUrl.startsWith("https://")
    ? "wss://"
    : "ws://";
  const wsHost = remote.serverUrl
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  let url = `${wsProtocol}${wsHost}${remotePath}`;
  if (remote.jwt) url += `?token=${encodeURIComponent(remote.jwt)}`;
  return url;
}
