import { useEffect, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  HostGridConfig,
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

function StatusDot({ status }: { status: string }) {
  const color =
    status === "online"
      ? getAccentColor()
      : status === "offline"
        ? "#ef4444"
        : "#6b7280";
  return (
    <span
      className="w-1.5 h-1.5 rounded-full shrink-0 inline-block"
      style={{ background: color }}
    />
  );
}

function HostGridWidget({
  widget,
  config,
}: WidgetComponentProps<HostGridConfig>) {
  const { t } = useTranslation();
  const { hostIds, showIp, columns } = config;
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
      const withStatus = filtered.map((h) => ({
        ...h,
        status:
          (statuses as Record<number, { status: string }>)[h.id]?.status ??
          h.status ??
          "unknown",
      }));
      setHosts(withStatus);
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

  const gridCols =
    columns === 2
      ? "grid-cols-2"
      : columns === 3
        ? "grid-cols-3"
        : "grid-cols-4";

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<LayoutGrid size={11} />} />
      <div
        className={`grid ${gridCols} gap-1.5 p-2 flex-1 content-start overflow-auto`}
      >
        {hosts.map((host) => (
          <div
            key={host.id}
            className="flex items-center gap-1.5 p-1.5 bg-muted/30 border border-border/40 overflow-hidden"
          >
            <StatusDot status={host.status ?? "unknown"} />
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] font-medium text-foreground truncate">
                {host.name}
              </span>
              {showIp && (
                <span className="text-[9px] text-muted-foreground truncate">
                  {host.ip}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

registerWidget<HostGridConfig>({
  id: "host_grid",
  name: "Host Grid",
  description: "Live status overview grid for all your SSH hosts",
  category: "monitoring",
  icon: <LayoutGrid size={14} />,
  defaultConfig: { hostIds: [], showIp: false, columns: 3 },
  defaultSize: { w: GRID_SIZE * 12, h: GRID_SIZE * 8 },
  minSize: { w: GRID_SIZE * 4, h: GRID_SIZE * 3 },
  component: HostGridWidget,
});

export { HostGridWidget };
