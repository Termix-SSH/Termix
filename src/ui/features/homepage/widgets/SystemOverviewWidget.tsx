import { useEffect, useState } from "react";
import { Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  SystemOverviewConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { getVersionInfo, getDatabaseHealth } from "@/api/system-status-api";
import { getUptime } from "@/api/dashboard-api";
import { WidgetTitle } from "./WidgetTitle";

interface InfoRowProps {
  label: string;
  value: string | null | undefined;
  valueColor?: string;
}

function InfoRow({ label, value, valueColor }: InfoRowProps) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-[10px] gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span
        className="text-foreground truncate text-right font-medium"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function SystemOverviewWidget({
  widget,
  config,
}: WidgetComponentProps<SystemOverviewConfig>) {
  const { t } = useTranslation();
  const { showVersion, showDbHealth, showUptime } = config;
  const [version, setVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dbStatus, setDbStatus] = useState<string | null>(null);
  const [uptimeFormatted, setUptimeFormatted] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      if (showVersion) {
        const info = await getVersionInfo(false);
        setVersion((info?.localVersion as string) ?? null);
        setUpdateAvailable(Boolean(info?.updateAvailable));
      }
      if (showDbHealth) {
        const health = await getDatabaseHealth();
        setDbStatus((health?.status as string) ?? "unknown");
      }
      if (showUptime) {
        const up = await getUptime();
        setUptimeFormatted(up.formatted);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 300_000);
    return () => clearInterval(iv);
  }, [showVersion, showDbHealth, showUptime]);

  const accent =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-brand")
      .trim() || "#f59145";

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle
        title={widget.title}
        icon={<Server size={11} />}
        fallback="Termix"
      />
      <div className="flex flex-col gap-1.5 p-3 flex-1 overflow-auto">
        {showVersion && (
          <InfoRow
            label={t("homepage.overviewVersion")}
            value={version ?? t("homepage.loading")}
            valueColor={updateAvailable ? "#f97316" : undefined}
          />
        )}
        {showVersion && updateAvailable && (
          <InfoRow
            label={t("homepage.overviewUpdate")}
            value={t("homepage.overviewUpdateAvailable")}
            valueColor="#f97316"
          />
        )}
        {showDbHealth && (
          <InfoRow
            label={t("homepage.overviewDatabase")}
            value={dbStatus ? dbStatus.toUpperCase() : t("homepage.loading")}
            valueColor={
              dbStatus === "ok" || dbStatus === "healthy"
                ? accent
                : dbStatus
                  ? "#ef4444"
                  : undefined
            }
          />
        )}
        {showUptime && (
          <InfoRow
            label={t("homepage.overviewUptime")}
            value={uptimeFormatted ?? t("homepage.loading")}
          />
        )}
      </div>
    </div>
  );
}

registerWidget<SystemOverviewConfig>({
  id: "system_overview",
  name: "System Overview",
  description: "Termix version, database health, and uptime at a glance",
  category: "system",
  icon: <Server size={14} />,
  defaultConfig: { showVersion: true, showDbHealth: true, showUptime: true },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 6 },
  minSize: { w: GRID_SIZE * 4, h: GRID_SIZE * 3 },
  component: SystemOverviewWidget,
});

export { SystemOverviewWidget };
