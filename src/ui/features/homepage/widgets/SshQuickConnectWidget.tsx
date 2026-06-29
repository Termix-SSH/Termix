import { useEffect, useState } from "react";
import { Zap, Terminal, FolderOpen, Container } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  SshQuickConnectConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import { getAllServerStatuses } from "@/api/host-metrics-status-api";
import type { SSHHostWithStatus } from "@/main-axios";
import { WidgetTitle } from "./WidgetTitle";

function getAccentColor(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-brand")
      .trim() || "#f59145"
  );
}

function TypeIcon({ type }: { type: string }) {
  if (type === "files") return <FolderOpen size={10} />;
  if (type === "docker") return <Container size={10} />;
  return <Terminal size={10} />;
}

function openTab(host: SSHHostWithStatus, connectionType: string) {
  window.dispatchEvent(
    new CustomEvent("termix:open-tab", {
      detail: {
        type:
          connectionType === "files"
            ? "files"
            : connectionType === "docker"
              ? "docker"
              : "terminal",
        host,
      },
    }),
  );
}

function SshQuickConnectWidget({
  widget,
  config,
}: WidgetComponentProps<SshQuickConnectConfig>) {
  const { t } = useTranslation();
  const { hostIds, connectionType, showStatus, layout } = config;
  const [hosts, setHosts] = useState<SSHHostWithStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [allHosts, statuses] = await Promise.all([
        getSSHHosts(),
        getAllServerStatuses().catch(
          () => ({}) as Record<number, { status: string }>,
        ),
      ]);
      const filtered =
        hostIds.length > 0
          ? allHosts.filter((h) => hostIds.includes(h.id))
          : allHosts;
      setHosts(
        filtered.map((h) => ({
          ...h,
          status:
            (statuses as Record<number, { status: string }>)[h.id]?.status ??
            h.status ??
            "unknown",
        })),
      );
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 10_000);
    return () => clearInterval(iv);
  }, [hostIds.join(",")]);

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.loading")}
      </div>
    );
  }

  if (hosts.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.noHosts")}
      </div>
    );
  }

  const accent = getAccentColor();
  const isGrid = layout === "grid";

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<Zap size={11} />} />
      <div
        className={`${isGrid ? "grid grid-cols-2 content-start" : "flex flex-col"} gap-1.5 p-2 flex-1 overflow-auto`}
      >
        {hosts.map((host) => {
          const online = host.status === "online";
          const statusColor =
            host.status === "online"
              ? accent
              : host.status === "offline"
                ? "#ef4444"
                : "#6b7280";
          return (
            <button
              key={host.id}
              onClick={() => openTab(host, connectionType)}
              className="flex items-center gap-1.5 p-2 bg-muted/30 border border-border/40 hover:border-accent-brand/50 hover:bg-muted/60 transition-colors text-left overflow-hidden"
            >
              <TypeIcon type={connectionType} />
              <span className="text-[10px] font-medium text-foreground truncate flex-1">
                {host.name}
              </span>
              {showStatus && (
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: statusColor }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

registerWidget<SshQuickConnectConfig>({
  id: "ssh_quick_connect",
  name: "Quick Connect",
  description: "One-click buttons to open SSH, file, or Docker tabs",
  category: "system",
  icon: <Zap size={14} />,
  defaultConfig: {
    hostIds: [],
    connectionType: "terminal",
    showStatus: true,
    layout: "list",
  },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 7 },
  minSize: { w: GRID_SIZE * 4, h: GRID_SIZE * 3 },
  component: SshQuickConnectWidget,
});

export { SshQuickConnectWidget };
