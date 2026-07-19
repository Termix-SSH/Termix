import type { SSHHostData } from "@/types";
import type { Host } from "@/types/ui-types";

type QuickConnectInput = Pick<
  Host,
  "ip" | "port" | "username" | "authType" | "password" | "key" | "credentialId"
>;

export function createQuickConnectHost(input: QuickConnectInput): Host {
  return {
    id: `quick-connect-${Date.now()}`,
    name: `${input.username}@${input.ip}`,
    ip: input.ip,
    port: input.port,
    username: input.username,
    authType: input.authType,
    password: input.authType === "password" ? input.password : undefined,
    key: input.authType === "key" ? input.key : undefined,
    credentialId:
      input.authType === "credential" ? input.credentialId : undefined,
    folder: "",
    online: false,
    cpu: null,
    ram: null,
    lastAccess: new Date().toISOString(),
    pin: false,
    defaultPath: "",
    serverTunnels: [],
    quickActions: [],
    enableTerminal: true,
    enableCommandHistory: true,
    enableFileManager: true,
    enableTunnel: true,
    enableDocker: true,
    enableProxmox: false,
    enableTmuxMonitor: false,
    enableSsh: true,
    enableRdp: false,
    enableVnc: false,
    enableTelnet: false,
    sshPort: input.port,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
  };
}

export function quickConnectHostToPayload(host: Host): SSHHostData {
  return {
    name: host.name,
    ip: host.ip,
    port: host.port,
    username: host.username,
    authType: host.authType,
    password: host.password,
    key: host.key,
    credentialId: host.credentialId
      ? Number.parseInt(host.credentialId, 10)
      : null,
    folder: host.folder,
    pin: host.pin,
    defaultPath: host.defaultPath,
    enableTerminal: true,
    enableSessionLogging: true,
    enableCommandHistory: host.enableCommandHistory,
    enableFileManager: host.enableFileManager,
    enableTunnel: host.enableTunnel,
    enableDocker: host.enableDocker,
    enableProxmox: host.enableProxmox,
    enableTmuxMonitor: host.enableTmuxMonitor,
    showTerminalInSidebar: true,
    showFileManagerInSidebar: true,
    showTunnelInSidebar: true,
    showDockerInSidebar: true,
    showServerStatsInSidebar: true,
    connectionType: "ssh",
    enableSsh: true,
    enableRdp: false,
    enableVnc: false,
    enableTelnet: false,
    sshPort: host.sshPort,
    rdpPort: host.rdpPort,
    vncPort: host.vncPort,
    telnetPort: host.telnetPort,
  };
}
