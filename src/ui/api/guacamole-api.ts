import {
  authApi,
  getRemoteGuacamoleApi,
  handleApiError,
  isElectron,
} from "@/main-axios";
import type { AxiosInstance } from "axios";
import type { GuacamoleConfig } from "@/types/guacamole-config";
import { resolveRemoteHostId } from "@/lib/remote-server-api";
import type { ConnectionOrigin } from "@/lib/connection-origin";

/**
 * Picks the backend that will actually serve this session, so the token and
 * status come from the same place as the connection.
 *
 * Outside Electron there is only one backend. Inside it, a host left on
 * Default still resolves to the connected server -- asking the embedded
 * backend would report the guacd *it* can reach rather than the one serving
 * the session. A host explicitly set to "This Device" (Support#1240) is
 * served by the embedded backend against the user's own guacd, so its calls
 * have to go there instead.
 *
 * Callers pass the origin explicitly rather than defaulting it: a default
 * silently sent a missed call site to the remote server, which fails with a
 * bare network error on a desktop that has none configured.
 */
function guacamoleApi(origin: ConnectionOrigin): AxiosInstance {
  if (!isElectron()) return authApi;
  return origin === "local" ? authApi : getRemoteGuacamoleApi();
}

export interface GuacamoleTokenRequest {
  protocol: "rdp" | "vnc" | "telnet";
  hostname: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  security?: string;
  ignoreCert?: boolean;
  guacamoleConfig?: GuacamoleConfig;
}

export interface GuacamoleTokenResponse {
  token: string;
  guacamoleConnectionId?: string | null;
}

type GuacamoleConfigSource = {
  guacamoleConfig?: string | Record<string, unknown> | null;
};

export function parseGuacamoleConfig(
  config?: string | GuacamoleConfig | null,
): GuacamoleConfig {
  if (!config) return {};
  if (typeof config !== "string") return config;
  try {
    return JSON.parse(config) as GuacamoleConfig;
  } catch {
    return {};
  }
}

export function getGuacamoleDpi(
  source?: GuacamoleConfigSource,
): number | undefined {
  const config = source?.guacamoleConfig;
  if (!config) return undefined;

  let dpi: unknown;
  if (typeof config === "string") {
    try {
      dpi = JSON.parse(config).dpi;
    } catch {
      return undefined;
    }
  } else {
    dpi = config.dpi;
  }

  const parsedDpi = typeof dpi === "string" ? Number(dpi) : dpi;
  if (
    typeof parsedDpi !== "number" ||
    !Number.isFinite(parsedDpi) ||
    parsedDpi <= 0
  ) {
    return undefined;
  }

  return Math.trunc(parsedDpi);
}

function toGuacamoleParams(
  config: GuacamoleTokenRequest["guacamoleConfig"],
): Record<string, unknown> {
  if (!config) return {};

  const params: Record<string, unknown> = {};

  const mappings: Record<string, string> = {
    colorDepth: "color-depth",
    resizeMethod: "resize-method",
    forceLossless: "force-lossless",
    disableAudio: "disable-audio",
    enableAudioInput: "enable-audio-input",
    enableWallpaper: "enable-wallpaper",
    enableTheming: "enable-theming",
    enableFontSmoothing: "enable-font-smoothing",
    enableFullWindowDrag: "enable-full-window-drag",
    enableDesktopComposition: "enable-desktop-composition",
    enableMenuAnimations: "enable-menu-animations",
    disableBitmapCaching: "disable-bitmap-caching",
    disableOffscreenCaching: "disable-offscreen-caching",
    disableGlyphCaching: "disable-glyph-caching",
    disableGfx: "disable-gfx",
    enablePrinting: "enable-printing",
    printerName: "printer-name",
    enableDrive: "enable-drive",
    driveName: "drive-name",
    drivePath: "drive-path",
    createDrivePath: "create-drive-path",
    disableDownload: "disable-download",
    disableUpload: "disable-upload",
    enableTouch: "enable-touch",
    clientName: "client-name",
    initialProgram: "initial-program",
    serverLayout: "server-layout",
    gatewayHostname: "gateway-hostname",
    gatewayPort: "gateway-port",
    gatewayUsername: "gateway-username",
    gatewayPassword: "gateway-password",
    gatewayDomain: "gateway-domain",
    remoteApp: "remote-app",
    remoteAppDir: "remote-app-dir",
    remoteAppArgs: "remote-app-args",
    normalizeClipboard: "normalize-clipboard",
    disableCopy: "disable-copy",
    disablePaste: "disable-paste",
    swapRedBlue: "swap-red-blue",
    readOnly: "read-only",
    recordingPath: "recording-path",
    recordingName: "recording-name",
    createRecordingPath: "create-recording-path",
    recordingExcludeOutput: "recording-exclude-output",
    recordingExcludeMouse: "recording-exclude-mouse",
    recordingIncludeKeys: "recording-include-keys",
    wolSendPacket: "wol-send-packet",
    wolMacAddr: "wol-mac-addr",
    wolBroadcastAddr: "wol-broadcast-addr",
    wolUdpPort: "wol-udp-port",
    wolWaitTime: "wol-wait-time",
  };

  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined && value !== null && value !== "") {
      const paramName = mappings[key] || key;
      if (typeof value === "boolean") {
        params[paramName] = value ? "true" : "false";
      } else {
        params[paramName] = value;
      }
    }
  }

  return params;
}

export async function getGuacamoleToken(
  request: GuacamoleTokenRequest,
  origin: ConnectionOrigin,
): Promise<GuacamoleTokenResponse> {
  try {
    const guacParams = toGuacamoleParams(request.guacamoleConfig);

    const response = await guacamoleApi(origin).post("/guacamole/token", {
      type: request.protocol,
      hostname: request.hostname,
      port: request.port,
      username: request.username,
      password: request.password,
      domain: request.domain,
      security: request.security,
      "ignore-cert": request.ignoreCert,
      ...guacParams,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get guacamole token");
  }
}

export async function getGuacamoleTokenFromHost(
  hostId: number,
  origin: ConnectionOrigin,
  protocol?: "rdp" | "vnc" | "telnet",
  promptedCredentials?: {
    username?: string;
    password?: string;
    domain?: string;
  },
  syncId?: string | null,
): Promise<GuacamoleTokenResponse> {
  try {
    // A locally-originated session is served by the embedded backend, which
    // knows the host by its local id -- remapping it onto the remote
    // server's id would address the wrong row, or fail outright when no
    // server is configured at all.
    const useRemote = isElectron() && origin === "remote";
    const remoteHostId = useRemote ? await resolveRemoteHostId(syncId) : null;
    if (useRemote && syncId && remoteHostId === null) {
      throw new Error("The synced host does not exist on the remote server");
    }
    const targetHostId = remoteHostId ?? hostId;
    const response = await guacamoleApi(origin).post(
      `/guacamole/connect-host/${targetHostId}`,
      {
        ...(protocol ? { protocol } : {}),
        ...(promptedCredentials?.username
          ? { promptedUsername: promptedCredentials.username }
          : {}),
        ...(promptedCredentials?.password
          ? { promptedPassword: promptedCredentials.password }
          : {}),
        ...(promptedCredentials
          ? { promptedDomain: promptedCredentials.domain ?? "" }
          : {}),
      },
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get guacamole token from host");
  }
}

export async function getGuacdStatus(origin: ConnectionOrigin): Promise<{
  guacd: { status: string };
}> {
  const response = await guacamoleApi(origin).get("/guacamole/status");
  return response.data;
}
