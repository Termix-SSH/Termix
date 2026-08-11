import React from "react";
import { useTranslation } from "react-i18next";
import { FullScreenAppWrapper } from "@/features/FullScreenAppWrapper.tsx";
import { TunnelTab } from "@/features/tunnel/TunnelTab.tsx";
import { ConnectionScreen } from "@/components/connection/ConnectionScreen.tsx";
import type { Host } from "@/types/ui-types";
import type { SSHHost } from "@/types";

interface TunnelAppProps {
  hostId?: string;
}

function sshHostToMinimalHost(h: SSHHost): Host {
  return {
    id: String(h.id),
    name: h.name,
    ip: h.ip,
    port: h.port,
    username: h.username,
    folder: h.folder ?? "",
    online: false,
    cpu: null,
    ram: null,
    lastAccess: "",
    tags: h.tags ?? [],
    pin: h.pin ?? false,
    authType: h.authType,
    enableTerminal: h.enableTerminal ?? false,
    enableCommandHistory: h.enableCommandHistory ?? false,
    enableProxmox: h.enableProxmox ?? false,
    enableProxmoxStats: h.enableProxmoxStats ?? false,
    enableTmuxMonitor: h.enableTmuxMonitor ?? false,
    enableTerminalToolbar: h.enableTerminalToolbar ?? true,
    enableTunnel: h.enableTunnel ?? false,
    enableFileManager: h.enableFileManager ?? false,
    enableDocker: h.enableDocker ?? false,
    enableSsh: h.enableSsh ?? true,
    enableRdp: h.enableRdp ?? false,
    enableVnc: h.enableVnc ?? false,
    enableTelnet: h.enableTelnet ?? false,
    sshPort: h.sshPort ?? h.port,
    rdpPort: h.rdpPort ?? 3389,
    vncPort: h.vncPort ?? 5900,
    telnetPort: h.telnetPort ?? 23,
    serverTunnels: [],
    quickActions: [],
  };
}

const TunnelApp: React.FC<TunnelAppProps> = ({ hostId }) => {
  const { t } = useTranslation();
  return (
    <FullScreenAppWrapper hostId={hostId}>
      {(hostConfig, phase) => {
        if (phase === "loading") {
          return (
            <div className="relative h-full w-full">
              <ConnectionScreen
                status="connecting"
                message={t("hosts.loadingHost")}
              />
            </div>
          );
        }

        if (!hostConfig) {
          return (
            <div className="relative h-full w-full">
              <ConnectionScreen
                status="disconnected"
                message={t("hosts.hostNotFound")}
              />
            </div>
          );
        }

        return (
          <TunnelTab
            label={hostConfig.name}
            host={sshHostToMinimalHost(hostConfig)}
          />
        );
      }}
    </FullScreenAppWrapper>
  );
};

export default TunnelApp;
