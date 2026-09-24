import type { PluginHostRecord } from "@termix/plugin-sdk/frontend";
import type { GuacamoleConfig } from "./guacamole-config";

export const PLUGIN_ID = "remote-desktop";

export type Protocol = "rdp" | "vnc" | "telnet";

/** This plugin's host settings, as they arrive on host.pluginSettings. */
export interface RemoteHostOptions {
  enableRdp: boolean;
  enableVnc: boolean;
  enableTelnet: boolean;
  rdpPort: number;
  vncPort: number;
  telnetPort: number;
  rdpSecurity: string;
  rdpIgnoreCert: boolean;
  guacamoleConfig: GuacamoleConfig;
  enableToolbar: boolean;
}

export const ENABLE_KEY = {
  rdp: "enableRdp",
  vnc: "enableVnc",
  telnet: "enableTelnet",
} as const satisfies Record<Protocol, keyof RemoteHostOptions>;

export const PORT_KEY = {
  rdp: "rdpPort",
  vnc: "vncPort",
  telnet: "telnetPort",
} as const satisfies Record<Protocol, keyof RemoteHostOptions>;

export const DEFAULT_PORT: Record<Protocol, number> = {
  rdp: 3389,
  vnc: 5900,
  telnet: 23,
};

/** The core fields holding a protocol's login, which stay on the host. */
export interface RemoteHostLogin {
  id?: number | string;
  name?: string | null;
  ip?: string;
  domain?: string;
  syncId?: string | null;
  connectionOrigin?: "local" | "remote" | null;
  rdpAuthType?: string;
  rdpUser?: string;
  rdpPassword?: string;
  vncUser?: string;
  vncPassword?: string;
  authOverrides?: Record<
    string,
    {
      credentialId?: number | string | null;
      required?: boolean;
      ownerAuthShared?: boolean;
    }
  >;
  pluginSettings?: Record<string, Record<string, unknown>>;
}

function port(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : fallback;
}

export function parseGuacamoleConfig(value: unknown): GuacamoleConfig {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? (value as GuacamoleConfig) : {};
}

export function remoteOptions(
  settings: Record<string, unknown> | undefined,
): RemoteHostOptions {
  const values = settings ?? {};
  return {
    enableRdp: values.enableRdp === true,
    enableVnc: values.enableVnc === true,
    enableTelnet: values.enableTelnet === true,
    rdpPort: port(values.rdpPort, DEFAULT_PORT.rdp),
    vncPort: port(values.vncPort, DEFAULT_PORT.vnc),
    telnetPort: port(values.telnetPort, DEFAULT_PORT.telnet),
    rdpSecurity:
      typeof values.rdpSecurity === "string" ? values.rdpSecurity : "",
    rdpIgnoreCert: values.rdpIgnoreCert === true,
    guacamoleConfig: parseGuacamoleConfig(values.guacamoleConfig),
    enableToolbar: values.enableToolbar !== false,
  };
}

export function hostRemoteOptions(
  host:
    | Pick<RemoteHostLogin, "pluginSettings">
    | PluginHostRecord
    | null
    | undefined,
): RemoteHostOptions {
  const bag = (host as RemoteHostLogin | null | undefined)?.pluginSettings;
  return remoteOptions(bag?.[PLUGIN_ID]);
}

export function protocolEnabled(
  host:
    | Pick<RemoteHostLogin, "pluginSettings">
    | PluginHostRecord
    | null
    | undefined,
  protocol: Protocol,
): boolean {
  return hostRemoteOptions(host)[ENABLE_KEY[protocol]];
}

/** Quick Connect hosts are never saved; their ids carry this prefix. */
const QUICK_CONNECT_ID_PREFIX = "quick-connect-";

export function isQuickConnectHost(host: { id?: unknown } | null | undefined) {
  return String(host?.id ?? "").startsWith(QUICK_CONNECT_ID_PREFIX);
}

export function errorMessage(error: unknown, fallback = "Unknown error") {
  const data = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data?.error;
  if (typeof data === "string" && data) return data;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}
