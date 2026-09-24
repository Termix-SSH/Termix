import { useEffect, useState } from "react";
import { Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  HostStatusConfig,
  HostMetricKey,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { getServerStatusById } from "@/api/host-status-api";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import { ComponentSlot } from "@/shell/ActionSlot";
import { WidgetTitle } from "./WidgetTitle";

function getAccentColor(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-brand")
      .trim() || "#f59145"
  );
}

const DEFAULT_METRICS: HostMetricKey[] = ["cpu", "memory"];

function migrateConfig(config: HostStatusConfig): HostMetricKey[] {
  if (config.shownMetrics?.length) return config.shownMetrics;
  if (config.showMetrics === false) return [];
  const metrics: HostMetricKey[] = ["cpu", "memory"];
  if (config.showDisk) metrics.push("disk");
  return metrics;
}

function HostStatusWidget({
  widget,
  config,
}: WidgetComponentProps<HostStatusConfig>) {
  const { t } = useTranslation();
  const shownMetrics = migrateConfig(config);
  const { hostId } = config;
  const [hostName, setHostName] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [reachable, setReachable] = useState(false);

  const needsMetrics = shownMetrics.length > 0;

  useEffect(() => {
    if (!hostId) return;
    getSSHHosts()
      .then((hosts) => {
        const host = hosts.find((h) => h.id === hostId);
        if (host) setHostName(host.name);
      })
      .catch(() => {});
  }, [hostId]);

  useEffect(() => {
    if (!hostId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const s = await getServerStatusById(hostId);
        if (!cancelled) {
          setOnline(s.status === "online");
          setReachable(s.status === "reachable");
        }
      } catch {
        if (!cancelled) {
          setOnline(false);
          setReachable(false);
        }
      }
    };

    poll();

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        if (document.visibilityState === "hidden") return;
        void poll();
      }, 30_000);
    };
    const stop = () => {
      if (intervalId === null) return;
      clearInterval(intervalId);
      intervalId = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      void poll();
      start();
    };

    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hostId]);

  if (!hostId) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.noHostSelected")}
      </div>
    );
  }

  const onlineColor =
    online === null
      ? "#6b7280"
      : online
        ? getAccentColor()
        : reachable
          ? "#fbbf24"
          : "#ef4444";
  const onlineLabel =
    online === null
      ? t("common.unknown")
      : online
        ? t("common.online")
        : reachable
          ? t("common.reachable", { defaultValue: "Reachable" })
          : t("common.offline");

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<Server size={11} />} />
      <div
        className={`flex flex-col gap-2.5 p-3 flex-1 overflow-auto ${!needsMetrics ? "justify-center" : ""}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Server size={14} className="text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold text-foreground truncate flex-1">
            {hostName ?? `Host #${hostId}`}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            <span
              className="w-1.5 h-1.5 shrink-0 rounded-full"
              style={{ background: onlineColor }}
            />
            <span
              className="text-[10px] font-medium"
              style={{ color: onlineColor }}
            >
              {onlineLabel}
            </span>
          </span>
        </div>

        {/* Plugins such as host metrics fill in the live numbers. */}
        {needsMetrics && (
          <ComponentSlot
            slotId="homepage.hostMetrics"
            props={{ hostId, shownMetrics, online: !!online }}
          />
        )}
      </div>
    </div>
  );
}

registerWidget<HostStatusConfig>({
  id: "host_status",
  name: "Host Status",
  description: "Shows live status and metrics for an SSH host",
  category: "system",
  icon: <Server size={14} />,
  defaultConfig: { hostId: 0, shownMetrics: DEFAULT_METRICS },
  defaultSize: { w: GRID_SIZE * 9, h: GRID_SIZE * 6 },
  minSize: { w: GRID_SIZE * 2, h: GRID_SIZE * 2 },
  component: HostStatusWidget,
});

export { HostStatusWidget };
