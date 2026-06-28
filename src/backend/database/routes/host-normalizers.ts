export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidPort(port: unknown): port is number {
  return typeof port === "number" && port > 0 && port <= 65535;
}

export const FOLDER_PATH_SEPARATOR = " / ";

/**
 * Re-paths a folder string when its ancestor folder is renamed. Returns the new
 * path for an exact match or any nested child, or null when the path is unrelated.
 * Mirrors the SQL CASE expression used in the folder rename route.
 */
export function renameFolderPath(
  folderPath: string,
  oldName: string,
  newName: string,
): string | null {
  if (folderPath === oldName) return newName;
  const prefix = `${oldName}${FOLDER_PATH_SEPARATOR}`;
  if (folderPath.startsWith(prefix)) {
    return `${newName}${FOLDER_PATH_SEPARATOR}${folderPath.slice(prefix.length)}`;
  }
  return null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asPort(value: unknown): number | undefined {
  const port =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : NaN;

  return isValidPort(port) ? port : undefined;
}

function asInteger(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : NaN;

  return Number.isInteger(number) ? number : undefined;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }

  return fallback;
}

function normalizeImportTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((tag) => asString(tag))
      .filter((tag): tag is string => !!tag);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

export type NormalizedImportedHost = Record<string, unknown> & {
  connectionType: string;
  name?: string;
  ip?: string;
  port: number;
  username?: string;
  folder?: string;
  tags: string[];
  authType?: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  credentialId?: number;
  credentialAlias?: string;
  pin?: unknown;
  enableTerminal?: unknown;
  enableTunnel?: unknown;
  enableFileManager?: unknown;
  enableDocker?: unknown;
  enableProxmox?: unknown;
  enableTmuxMonitor?: unknown;
  showTerminalInSidebar?: unknown;
  showFileManagerInSidebar?: unknown;
  showTunnelInSidebar?: unknown;
  showDockerInSidebar?: unknown;
  showServerStatsInSidebar?: unknown;
  defaultPath?: unknown;
  sudoPassword?: unknown;
  tunnelConnections?: unknown;
  jumpHosts?: unknown;
  quickActions?: unknown;
  statsConfig?: unknown;
  dockerConfig?: unknown;
  proxmoxConfig?: unknown;
  terminalConfig?: unknown;
  forceKeyboardInteractive?: unknown;
  notes?: unknown;
  useSocks5?: unknown;
  socks5Host?: unknown;
  socks5Port?: unknown;
  socks5Username?: unknown;
  socks5Password?: unknown;
  socks5ProxyChain?: unknown;
  portKnockSequence?: unknown;
  overrideCredentialUsername?: unknown;
  domain?: unknown;
  security?: unknown;
  ignoreCert?: unknown;
  guacamoleConfig?: unknown;
  enableSsh: boolean;
  enableRdp: boolean;
  enableVnc: boolean;
  enableTelnet: boolean;
};

export function normalizeImportedHost(
  hostData: Record<string, unknown>,
): NormalizedImportedHost {
  const credentialAlias =
    asString(hostData.credentialAlias) || asString(hostData.credentialName);
  const connectionType =
    asString(hostData.connectionType) ||
    (asBoolean(hostData.enableRdp)
      ? "rdp"
      : asBoolean(hostData.enableVnc)
        ? "vnc"
        : asBoolean(hostData.enableTelnet)
          ? "telnet"
          : "ssh");

  const port =
    asPort(hostData.port) ||
    (connectionType === "rdp"
      ? asPort(hostData.rdpPort) || 3389
      : connectionType === "vnc"
        ? asPort(hostData.vncPort) || 5900
        : connectionType === "telnet"
          ? asPort(hostData.telnetPort) || 23
          : asPort(hostData.sshPort) || 22);

  return {
    ...hostData,
    connectionType,
    name: asString(hostData.name) || asString(hostData.label),
    ip:
      asString(hostData.ip) ||
      asString(hostData.address) ||
      asString(hostData.host) ||
      asString(hostData.hostname),
    port,
    username: asString(hostData.username) || asString(hostData.user),
    folder: asString(hostData.folder) || asString(hostData.group),
    tags: normalizeImportTags(hostData.tags),
    credentialId: asInteger(hostData.credentialId),
    credentialAlias,
    authType:
      asString(hostData.authType) ||
      asString(hostData.authMethod) ||
      (hostData.credentialId || credentialAlias
        ? "credential"
        : hostData.key
          ? "key"
          : undefined),
    enableSsh:
      hostData.enableSsh === undefined
        ? connectionType === "ssh"
        : asBoolean(hostData.enableSsh),
    enableRdp:
      hostData.enableRdp === undefined
        ? connectionType === "rdp"
        : asBoolean(hostData.enableRdp),
    enableVnc:
      hostData.enableVnc === undefined
        ? connectionType === "vnc"
        : asBoolean(hostData.enableVnc),
    enableTelnet:
      hostData.enableTelnet === undefined
        ? connectionType === "telnet"
        : asBoolean(hostData.enableTelnet),
  };
}

const SENSITIVE_FIELDS = [
  "key",
  "keyPassword",
  "autostartKey",
  "autostartKeyPassword",
  "password",
  "sudoPassword",
  "socks5Password",
  "rdpPassword",
  "vncPassword",
  "telnetPassword",
  "autostartPassword",
];

export function stripSensitiveFields(
  host: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...host };
  result.hasKey = !!host.key;
  result.hasKeyPassword = !!host.keyPassword;
  result.hasPassword = !!host.password;
  result.hasSudoPassword = !!host.sudoPassword;
  for (const field of SENSITIVE_FIELDS) {
    delete result[field];
  }
  return result;
}

export function transformHostResponse(
  host: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...host,
    tags:
      typeof host.tags === "string"
        ? host.tags
          ? host.tags.split(",").filter(Boolean)
          : []
        : [],
    pin: !!host.pin,
    enableTerminal: !!host.enableTerminal,
    enableTunnel: !!host.enableTunnel,
    enableFileManager: host.enableFileManager !== false,
    enableDocker: !!host.enableDocker,
    enableProxmox: !!host.enableProxmox,
    enableTmuxMonitor: !!host.enableTmuxMonitor,
    showTerminalInSidebar: !!host.showTerminalInSidebar,
    showFileManagerInSidebar: !!host.showFileManagerInSidebar,
    showTunnelInSidebar: !!host.showTunnelInSidebar,
    showDockerInSidebar: !!host.showDockerInSidebar,
    showServerStatsInSidebar: !!host.showServerStatsInSidebar,
    // Old hosts only had connection_type set; the per-protocol enable flags didn't exist yet.
    // The schema defaults (enableSsh=true, others=false) wrongly mark every old host as SSH.
    // Detect this migration case: if no non-SSH protocol is explicitly enabled AND
    // connectionType is set to a non-SSH value, fall back to inferring from connectionType.
    ...(() => {
      const ct = host.connectionType;
      const rdp = !!host.enableRdp;
      const vnc = !!host.enableVnc;
      const tel = !!host.enableTelnet;
      const isMigratedNonSsh = !rdp && !vnc && !tel && ct && ct !== "ssh";
      return {
        enableSsh: isMigratedNonSsh ? false : !!host.enableSsh,
        enableRdp: isMigratedNonSsh ? ct === "rdp" : rdp,
        enableVnc: isMigratedNonSsh ? ct === "vnc" : vnc,
        enableTelnet: isMigratedNonSsh ? ct === "telnet" : tel,
      };
    })(),
    sshPort: host.sshPort ?? host.port ?? 22,
    rdpPort: host.rdpPort ?? 3389,
    vncPort: host.vncPort ?? 5900,
    telnetPort: host.telnetPort ?? 23,
    rdpUser: host.rdpUser || undefined,
    rdpDomain: host.rdpDomain || undefined,
    rdpSecurity: host.rdpSecurity || undefined,
    rdpIgnoreCert: !!host.rdpIgnoreCert,
    vncUser: host.vncUser || undefined,
    telnetUser: host.telnetUser || undefined,
    tunnelConnections: host.tunnelConnections
      ? JSON.parse(host.tunnelConnections as string)
      : [],
    jumpHosts: host.jumpHosts ? JSON.parse(host.jumpHosts as string) : [],
    quickActions: host.quickActions
      ? JSON.parse(host.quickActions as string)
      : [],
    statsConfig: host.statsConfig
      ? JSON.parse(host.statsConfig as string)
      : undefined,
    terminalConfig: host.terminalConfig
      ? JSON.parse(host.terminalConfig as string)
      : undefined,
    dockerConfig: host.dockerConfig
      ? JSON.parse(host.dockerConfig as string)
      : undefined,
    proxmoxConfig: host.proxmoxConfig
      ? JSON.parse(host.proxmoxConfig as string)
      : undefined,
    forceKeyboardInteractive: host.forceKeyboardInteractive === "true",
    useWarpgate: !!host.useWarpgate,
    socks5ProxyChain: host.socks5ProxyChain
      ? JSON.parse(host.socks5ProxyChain as string)
      : [],
    portKnockSequence: host.portKnockSequence
      ? JSON.parse(host.portKnockSequence as string)
      : [],
    domain: host.domain || undefined,
    security: host.security || undefined,
    ignoreCert: !!host.ignoreCert,
    guacamoleConfig: host.guacamoleConfig
      ? JSON.parse(host.guacamoleConfig as string)
      : undefined,
  };
}
