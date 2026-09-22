export function buildGuacamoleWebSocketBaseUrl({
  isDev,
  isElectronApp,
  isEmbeddedApp,
  configuredServerUrl,
  basePath,
  location,
}: {
  isDev: boolean;
  isElectronApp: boolean;
  isEmbeddedApp: boolean;
  configuredServerUrl?: string;
  basePath: string;
  location: Pick<Location, "protocol" | "host">;
}) {
  if (isDev) return "ws://localhost:30008";
  if (isElectronApp) {
    if (isEmbeddedApp || !configuredServerUrl) return "ws://127.0.0.1:30008";

    const wsProtocol = configuredServerUrl.startsWith("https://")
      ? "wss://"
      : "ws://";
    const wsHost = configuredServerUrl
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    return `${wsProtocol}${wsHost}/guacamole/websocket/`;
  }

  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
  return `${wsProtocol}://${location.host}${basePath}/guacamole/websocket/`;
}
