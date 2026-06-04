import { authApi, handleApiError } from "@/main-axios";

export interface GuacamoleTokenRequest {
  protocol: "rdp" | "vnc" | "telnet";
  hostname: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  security?: string;
  ignoreCert?: boolean;
  guacamoleConfig?: {
    colorDepth?: number;
    width?: number;
    height?: number;
    dpi?: number;
    resizeMethod?: string;
    forceLossless?: boolean;
    disableAudio?: boolean;
    enableAudioInput?: boolean;
    enableWallpaper?: boolean;
    enableTheming?: boolean;
    enableFontSmoothing?: boolean;
    enableFullWindowDrag?: boolean;
    enableDesktopComposition?: boolean;
    enableMenuAnimations?: boolean;
    disableBitmapCaching?: boolean;
    disableOffscreenCaching?: boolean;
    disableGlyphCaching?: boolean;
    disableGfx?: boolean;
    enablePrinting?: boolean;
    printerName?: string;
    enableDrive?: boolean;
    driveName?: string;
    drivePath?: string;
    createDrivePath?: boolean;
    disableDownload?: boolean;
    disableUpload?: boolean;
    enableTouch?: boolean;
    clientName?: string;
    console?: boolean;
    initialProgram?: string;
    serverLayout?: string;
    timezone?: string;
    gatewayHostname?: string;
    gatewayPort?: number;
    gatewayUsername?: string;
    gatewayPassword?: string;
    gatewayDomain?: string;
    remoteApp?: string;
    remoteAppDir?: string;
    remoteAppArgs?: string;
    normalizeClipboard?: string;
    disableCopy?: boolean;
    disablePaste?: boolean;
    cursor?: string;
    swapRedBlue?: boolean;
    readOnly?: boolean;
    recordingPath?: string;
    recordingName?: string;
    createRecordingPath?: boolean;
    recordingExcludeOutput?: boolean;
    recordingExcludeMouse?: boolean;
    recordingIncludeKeys?: boolean;
    wolSendPacket?: boolean;
    wolMacAddr?: string;
    wolBroadcastAddr?: string;
    wolUdpPort?: number;
    wolWaitTime?: number;
  };
}

export interface GuacamoleTokenResponse {
  token: string;
}

type GuacamoleConfigSource = {
  guacamoleConfig?: string | Record<string, unknown> | null;
};

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
): Promise<GuacamoleTokenResponse> {
  try {
    const guacParams = toGuacamoleParams(request.guacamoleConfig);

    const response = await authApi.post("/guacamole/token", {
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
  protocol?: "rdp" | "vnc" | "telnet",
): Promise<GuacamoleTokenResponse> {
  try {
    const response = await authApi.post(
      `/guacamole/connect-host/${hostId}`,
      protocol ? { protocol } : {},
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get guacamole token from host");
  }
}

export async function getGuacdStatus(): Promise<{
  guacd: { status: string };
}> {
  const response = await authApi.get("/guacamole/status");
  return response.data;
}
