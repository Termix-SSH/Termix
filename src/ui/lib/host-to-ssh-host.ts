import type { Host } from "@/types/ui-types";
import type { SSHHost } from "@/types";

/** The shell's Host in the SSHHost shape the connection surfaces take. */
export function hostToSSHHost(h: Host): SSHHost {
  return {
    id: parseInt(h.id, 10),
    name: h.name,
    ip: h.ip,
    port: h.port,
    username: h.username,
    folder: h.folder ?? "",
    tags: h.tags ?? [],
    pin: h.pin ?? false,
    authType: h.authType,
    password: h.password,
    hasPassword: h.hasPassword,
    key: h.key,
    keyPassword: h.keyPassword,
    hasKey: h.hasKey,
    hasKeyPassword: h.hasKeyPassword,
    keyType: h.keyType,
    credentialId: h.credentialId ? parseInt(h.credentialId, 10) : undefined,
    terminalConfig: h.terminalConfig,
    hasSudoPassword: h.hasSudoPassword,
    enableTerminal: h.enableTerminal ?? false,
    enableTunnel: h.enableTunnel ?? false,
    enableFileManager: h.enableFileManager ?? false,
    enableTerminalToolbar: h.enableTerminalToolbar ?? true,
    enableWebUi: h.enableWebUi ?? false,
    webUiConfig: (h.pluginSettings?.["web-endpoint"]?.webUiConfig as
      SSHHost["webUiConfig"] | undefined) ?? { endpoints: [] },
    showTerminalInSidebar: true,
    showFileManagerInSidebar: true,
    showTunnelInSidebar: true,
    showDockerInSidebar: true,
    showServerStatsInSidebar: true,
    defaultPath: h.defaultPath ?? "",
    tunnelConnections: [],
    connectionType: "ssh",
    connectionOrigin: h.connectionOrigin ?? null,
    isShared: h.isShared ?? false,
    // Carries the host's identity to a delegated backend. Without it the
    // remote side resolves our local row id against its own table.
    syncId: h.syncId ?? null,
    createdAt: "",
    updatedAt: "",
  } as unknown as SSHHost;
}
