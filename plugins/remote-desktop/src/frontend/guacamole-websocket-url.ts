/**
 * Where the Guacamole display socket lives.
 *
 * One path in every deployment: the plugin serves it at
 * /plugin-ws/remote-desktop/display on the main backend, so there is no
 * guacamole port and no separate nginx block any more. Electron with a remote
 * server is the only case that targets a different host.
 */
export function buildGuacamoleWebSocketBaseUrl({
  isElectronApp,
  isEmbeddedApp,
  configuredServerUrl,
  basePath,
  location,
}: {
  isDev?: boolean;
  isElectronApp: boolean;
  isEmbeddedApp: boolean;
  configuredServerUrl?: string;
  basePath: string;
  location: Pick<Location, "protocol" | "host">;
}) {
  const route = "/plugin-ws/remote-desktop/display";

  if (isElectronApp && !isEmbeddedApp && configuredServerUrl) {
    const wsProtocol = configuredServerUrl.startsWith("https://")
      ? "wss://"
      : "ws://";
    const wsHost = configuredServerUrl
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    return `${wsProtocol}${wsHost}${route}`;
  }

  if (isElectronApp) return `ws://127.0.0.1:30001${route}`;

  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
  return `${wsProtocol}://${location.host}${basePath}${route}`;
}
