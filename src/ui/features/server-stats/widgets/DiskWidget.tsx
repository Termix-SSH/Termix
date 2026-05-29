import { HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios.ts";
import { SectionCard } from "@/components/section-card";

interface DiskWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

function Sparkline({
  history,
  current,
}: {
  history: ServerMetrics[];
  current: number | null;
}) {
  const points = [
    ...history.map((m) => m?.disk?.percent ?? 0),
    current ?? 0,
  ].slice(-20);

  const w = 300;
  const h = 48;

  const hasData = points.length >= 2;
  const max = hasData ? Math.max(...points, 1) : 1;
  const coords = hasData
    ? points.map((v, i) => {
        const x = (i / (points.length - 1)) * w;
        const y = h - (v / max) * h;
        return `${x},${y}`;
      })
    : [];

  const d = hasData ? `M ${coords.join(" L ")}` : "";
  const fill = hasData ? `M 0,${h} L ${coords.join(" L ")} L ${w},${h} Z` : "";

  return (
    <div className="h-12 md:h-16 w-full mt-2 bg-muted/20 border border-border/50 relative overflow-hidden">
      {hasData && (
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
        >
          <path d={fill} fill="currentColor" className="text-accent-brand/10" />
          <path
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-accent-brand/60"
          />
        </svg>
      )}
    </div>
  );
}

export function DiskWidget({ metrics, metricsHistory }: DiskWidgetProps) {
  const { t } = useTranslation();
  const percent = metrics?.disk?.percent ?? null;
  const usedHuman = metrics?.disk?.usedHuman ?? null;
  const totalHuman = metrics?.disk?.totalHuman ?? null;
  const availableHuman = metrics?.disk?.availableHuman ?? null;

  return (
    <SectionCard
      title={t("serverStats.diskUsage")}
      icon={<HardDrive className="size-3.5" />}
    >
      <div className="flex flex-col gap-4 py-2">
        <div className="flex items-end justify-between">
          <div className="flex flex-col">
            <span className="text-xl md:text-3xl font-bold text-accent-brand">
              {percent !== null ? `${percent}%` : "N/A"}
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
              {usedHuman && totalHuman ? `${usedHuman} / ${totalHuman}` : "N/A"}
            </span>
          </div>
        </div>
        <div className="h-2 bg-muted w-full overflow-hidden">
          <div
            className="h-full bg-accent-brand transition-all duration-500"
            style={{ width: `${percent ?? 0}%` }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground font-semibold">
              {t("serverStats.available")}
            </span>
            <span className="font-mono">{availableHuman ?? "N/A"}</span>
          </div>
        </div>
        <Sparkline history={metricsHistory} current={percent} />
      </div>
    </SectionCard>
  );
}
