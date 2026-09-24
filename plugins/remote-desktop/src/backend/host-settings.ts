import type { PluginContext } from "@termix/plugin-sdk/backend";

export type RemoteProtocol = "rdp" | "vnc" | "telnet";

export const PLUGIN_ID = "remote-desktop";

export interface RemoteDesktopHostSettings {
  enableRdp: boolean;
  enableVnc: boolean;
  enableTelnet: boolean;
  rdpPort: number;
  vncPort: number;
  telnetPort: number;
  rdpSecurity: string;
  rdpIgnoreCert: boolean;
  guacamoleConfig: Record<string, unknown>;
  enableToolbar: boolean;
}

export const ENABLE_KEY: Record<
  RemoteProtocol,
  keyof RemoteDesktopHostSettings
> = { rdp: "enableRdp", vnc: "enableVnc", telnet: "enableTelnet" };

export const PORT_KEY: Record<RemoteProtocol, keyof RemoteDesktopHostSettings> =
  { rdp: "rdpPort", vnc: "vncPort", telnet: "telnetPort" };

export const DEFAULT_PORT: Record<RemoteProtocol, number> = {
  rdp: 3389,
  vnc: 5900,
  telnet: 23,
};

export function isRemoteProtocol(value: unknown): value is RemoteProtocol {
  return value === "rdp" || value === "vnc" || value === "telnet";
}

function asPort(value: unknown): number | undefined {
  const port = typeof value === "string" ? Number(value) : value;
  return typeof port === "number" &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535
    ? port
    : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

function asBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return undefined;
}

export async function readHostSettings(
  ctx: PluginContext,
  hostId: number,
): Promise<RemoteDesktopHostSettings> {
  const values = await ctx.settings.getAll("host", hostId);
  return {
    enableRdp: values.enableRdp === true,
    enableVnc: values.enableVnc === true,
    enableTelnet: values.enableTelnet === true,
    rdpPort: asPort(values.rdpPort) ?? DEFAULT_PORT.rdp,
    vncPort: asPort(values.vncPort) ?? DEFAULT_PORT.vnc,
    telnetPort: asPort(values.telnetPort) ?? DEFAULT_PORT.telnet,
    rdpSecurity:
      typeof values.rdpSecurity === "string" ? values.rdpSecurity : "",
    rdpIgnoreCert: values.rdpIgnoreCert === true,
    guacamoleConfig: asObject(values.guacamoleConfig) ?? {},
    enableToolbar: values.enableToolbar !== false,
  };
}

/**
 * Turns an imported host row into this plugin's host settings.
 *
 * A Termix export carries them under pluginSettings["remote-desktop"]. Older
 * exports, other tools and a plugin creating a host (proxmox) use the flat
 * fields the host row had before 2.9.0, including the connectionType-only
 * shape of hosts from before the per-protocol switches existed.
 */
export function normalizeImportedHost(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const nested =
    asObject(asObject(raw.pluginSettings)?.[PLUGIN_ID]) ??
    ({} as Record<string, unknown>);
  const pick = (key: string, legacy?: string) =>
    nested[key] !== undefined
      ? nested[key]
      : raw[key] !== undefined
        ? raw[key]
        : legacy !== undefined
          ? raw[legacy]
          : undefined;

  const out: Record<string, unknown> = {};
  for (const protocol of ["rdp", "vnc", "telnet"] as const) {
    const key = ENABLE_KEY[protocol];
    const flag = asBool(pick(key));
    if (flag !== undefined) out[key] = flag;
    const port = asPort(pick(PORT_KEY[protocol]));
    if (port !== undefined) out[PORT_KEY[protocol]] = port;
  }

  const anyFlag = ["enableRdp", "enableVnc", "enableTelnet"].some(
    (key) => out[key] === true,
  );
  if (!anyFlag && isRemoteProtocol(raw.connectionType)) {
    out[ENABLE_KEY[raw.connectionType]] = true;
    const port = asPort(raw.port);
    if (port !== undefined && out[PORT_KEY[raw.connectionType]] === undefined) {
      out[PORT_KEY[raw.connectionType]] = port;
    }
  }

  const security = pick("rdpSecurity", "security");
  if (typeof security === "string" && security) out.rdpSecurity = security;
  const ignoreCert = asBool(pick("rdpIgnoreCert", "ignoreCert"));
  if (ignoreCert !== undefined) out.rdpIgnoreCert = ignoreCert;
  const config = asObject(pick("guacamoleConfig"));
  if (config && Object.keys(config).length > 0) out.guacamoleConfig = config;
  const toolbar = asBool(pick("enableToolbar", "enableTerminalToolbar"));
  if (toolbar !== undefined) out.enableToolbar = toolbar;

  return Object.keys(out).length > 0 ? out : null;
}

/** User setting key to the guacd parameter it sets. */
const USER_DEFAULT_PARAMS: Record<string, string> = {
  colorDepth: "color-depth",
  resizeMethod: "resize-method",
  forceLossless: "force-lossless",
  enableWallpaper: "enable-wallpaper",
  enableFontSmoothing: "enable-font-smoothing",
  enableDesktopComposition: "enable-desktop-composition",
  disableAudio: "disable-audio",
  enablePrinting: "enable-printing",
  enableDrive: "enable-drive",
  disableCopy: "disable-copy",
  disablePaste: "disable-paste",
};

/**
 * The user's RDP defaults as guacd parameters. "inherit" leaves a parameter
 * to the host and guacd; on and off become booleans.
 */
export function userDefaultParams(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, param] of Object.entries(USER_DEFAULT_PARAMS)) {
    const value = values[key];
    if (value === undefined || value === null || value === "inherit") continue;
    if (key === "colorDepth") {
      const depth = Number(value);
      if (Number.isInteger(depth) && depth > 0) params[param] = depth;
    } else if (key === "resizeMethod") {
      if (typeof value === "string" && value) params[param] = value;
    } else if (value === "on" || value === "off") {
      params[param] = value === "on";
    }
  }
  return params;
}

export async function readUserDefaults(
  ctx: PluginContext,
  userId: string,
): Promise<Record<string, unknown>> {
  return userDefaultParams(await ctx.settings.getAll("user", userId));
}
