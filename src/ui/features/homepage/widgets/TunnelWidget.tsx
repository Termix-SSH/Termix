import { useState, useEffect } from "react";
import { Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  TunnelWidgetConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import type { SSHHostWithStatus } from "@/main-axios";
import { TunnelTab } from "@/features/tunnel/TunnelTab";
import { WidgetTitle } from "./WidgetTitle";

function TunnelWidget({
  widget,
  config,
}: WidgetComponentProps<TunnelWidgetConfig>) {
  const { t } = useTranslation();
  const [host, setHost] = useState<SSHHostWithStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!config.hostId) {
      setLoading(false);
      return;
    }
    getSSHHosts()
      .then((hosts) => {
        const found = hosts.find(
          (h) => h.id === config.hostId && h.enableTunnel,
        );
        setHost(found ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [config.hostId]);

  if (!config.hostId) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2 text-muted-foreground/60">
        <Network size={20} />
        <span className="text-xs">{t("homepage.widgetNoHostSelected")}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground/60">
        {t("homepage.loading")}
      </div>
    );
  }

  if (!host) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground/60">
        {t("homepage.widgetNoHostSelected")}
      </div>
    );
  }

  // TunnelTab expects Host (ui-types) — id must be a string
  const tunnelHost = {
    id: String(host.id),
    name: host.name,
    username: host.username,
    ip: host.ip,
    port: host.port,
    folder: host.folder ?? "",
    online: host.status === "online",
    cpu: null,
    ram: null,
    lastAccess: "",
    authType: host.authType,
    enableTerminal: host.enableTerminal ?? false,
    enableCommandHistory: false,
    enableTunnel: host.enableTunnel ?? false,
    serverTunnels: [],
    enableFileManager: host.enableFileManager ?? false,
    enableDocker: host.enableDocker ?? false,
    enableProxmox: false,
    enableTmuxMonitor: false,
    enableSsh: host.enableSsh ?? true,
    enableRdp: host.enableRdp ?? false,
    enableVnc: host.enableVnc ?? false,
    enableTelnet: host.enableTelnet ?? false,
    sshPort: host.sshPort ?? host.port,
    rdpPort: host.rdpPort ?? 3389,
    vncPort: host.vncPort ?? 5900,
    telnetPort: host.telnetPort ?? 23,
    quickActions: [],
  };

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<Network size={11} />} />
      <div
        className="flex-1 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <TunnelTab
          label={host.name || host.ip}
          host={tunnelHost as Parameters<typeof TunnelTab>[0]["host"]}
        />
      </div>
    </div>
  );
}

registerWidget<TunnelWidgetConfig>({
  id: "tunnel_widget",
  name: "Tunnel Manager",
  description: "Embedded SSH tunnel manager for a configured host",
  category: "system",
  icon: <Network size={14} />,
  defaultConfig: { hostId: 0 },
  defaultSize: { w: GRID_SIZE * 16, h: GRID_SIZE * 10 },
  minSize: { w: GRID_SIZE * 8, h: GRID_SIZE * 6 },
  component: TunnelWidget,
});
