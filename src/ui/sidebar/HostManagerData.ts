import type { SSHHostWithStatus } from "@/main-axios";
import type { Host, Credential } from "@/types/ui-types";

type RawSSHHost = SSHHostWithStatus & {
  hasKey?: boolean;
  hasKeyPassword?: boolean;
};
type HostQuickAction = Host["quickActions"][number];
type HostJumpHost = NonNullable<Host["jumpHosts"]>[number];
type RawCredential = {
  id: number | string;
  name: string;
  username: string;
  authType?: string;
  description?: string | null;
  folder?: string | null;
  tags?: string[];
  publicKey?: string | null;
};

function parseJson<T>(v: unknown): T | undefined {
  if (!v) return undefined;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return undefined;
    }
  }
  return v as T;
}

export function sshHostToHost(h: SSHHostWithStatus): Host {
  const host = h as RawSSHHost;
  return {
    id: String(h.id),
    name: h.name,
    username: h.username,
    ip: h.ip,
    port: h.port,
    folder: h.folder ?? "",
    online: h.status === "online",
    cpu: null,
    ram: null,
    lastAccess: "",
    tags: h.tags ?? [],
    authType: h.authType,
    password: h.password,
    hasKey: !!host.hasKey || !!(typeof h.key === "string" && h.key),
    hasKeyPassword: !!host.hasKeyPassword || !!h.keyPassword,
    key: typeof h.key === "string" ? h.key : undefined,
    keyPassword: h.keyPassword,
    keyType: h.keyType,
    credentialId: h.credentialId != null ? String(h.credentialId) : undefined,
    notes: h.notes,
    pin: h.pin ?? false,
    macAddress: h.macAddress,
    enableSsh: h.enableSsh != null ? h.enableSsh : h.connectionType === "ssh",
    enableTerminal:
      h.enableTerminal ??
      (h.enableSsh != null ? h.enableSsh : h.connectionType === "ssh"),
    enableSessionLogging: h.enableSessionLogging ?? true,
    enableCommandHistory: h.enableCommandHistory ?? true,
    enableTunnel: h.enableTunnel ?? false,
    enableFileManager: h.enableFileManager ?? true,
    enableDocker: h.enableDocker ?? false,
    enableProxmox: h.enableProxmox ?? false,
    enableTmuxMonitor: h.enableTmuxMonitor ?? false,
    proxmoxConfig: h.proxmoxConfig ?? null,
    enableRdp: h.enableRdp != null ? h.enableRdp : h.connectionType === "rdp",
    enableVnc: h.enableVnc != null ? h.enableVnc : h.connectionType === "vnc",
    enableTelnet:
      h.enableTelnet != null ? h.enableTelnet : h.connectionType === "telnet",
    sshPort:
      h.sshPort ??
      (h.connectionType === "ssh" || !h.connectionType ? h.port : 22),
    rdpPort: h.rdpPort ?? (h.connectionType === "rdp" ? h.port : 3389),
    vncPort: h.vncPort ?? (h.connectionType === "vnc" ? h.port : 5900),
    telnetPort: h.telnetPort ?? (h.connectionType === "telnet" ? h.port : 23),
    rdpUser: h.rdpUser,
    rdpPassword: h.rdpPassword ?? "",
    domain: h.rdpDomain,
    security: h.rdpSecurity,
    ignoreCert: h.rdpIgnoreCert ?? false,
    vncPassword: h.vncPassword ?? "",
    vncUser: h.vncUser,
    telnetUser: h.telnetUser,
    telnetPassword: h.telnetPassword ?? "",
    quickActions: (h.quickActions ?? []).map((a: HostQuickAction) => ({
      name: a.name,
      snippetId: String(a.snippetId),
    })),
    serverTunnels: parseJson(h.tunnelConnections) ?? [],
    jumpHosts: (parseJson<HostJumpHost[]>(h.jumpHosts) ?? []).map((j) => ({
      hostId: String(j.hostId ?? j.hostid ?? j),
    })),
    portKnockSequence: parseJson(h.portKnockSequence) ?? [],
    defaultPath: h.defaultPath,
    terminalConfig: parseJson(h.terminalConfig) as Host["terminalConfig"],
    statsConfig: parseJson(h.statsConfig) as Host["statsConfig"],
    guacamoleConfig: parseJson(h.guacamoleConfig),
    forceKeyboardInteractive: h.forceKeyboardInteractive ?? false,
    useSocks5: h.useSocks5,
    socks5Host: h.socks5Host,
    socks5Port: h.socks5Port,
    socks5Username: h.socks5Username,
    socks5Password: h.socks5Password,
    socks5ProxyChain: parseJson(h.socks5ProxyChain) ?? [],
    overrideCredentialUsername: h.overrideCredentialUsername ?? false,
  };
}

export function mapCredentials(res: unknown): Credential[] {
  const arr = Array.isArray(res) ? res : [];
  return (arr as RawCredential[]).map((c) => ({
    id: String(c.id),
    name: c.name,
    username: c.username,
    type: c.authType === "key" ? "key" : "password",
    description: c.description ?? "",
    folder: c.folder ?? "",
    tags: c.tags ?? [],
    publicKey: c.publicKey ?? undefined,
  }));
}
