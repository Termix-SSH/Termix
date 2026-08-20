import { useTranslation } from "react-i18next";
import { Cpu, MemoryStick, HardDrive, Clock, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProxmoxNodeStats } from "@/types/proxmox";

function Tile({
  icon,
  label,
  percent,
  detail,
  sparkline,
}: {
  icon: React.ReactNode;
  label: string;
  percent: number | null;
  detail?: string | null;
  sparkline?: number[];
}) {
  const clamped = percent === null ? null : Math.min(100, Math.max(0, percent));
  const barColor =
    clamped === null
      ? "bg-muted-foreground/30"
      : clamped >= 90
        ? "bg-red-500"
        : clamped >= 75
          ? "bg-yellow-500"
          : "bg-accent-brand";

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-widest">
          {label}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xl font-bold tabular-nums">
          {clamped === null ? "N/A" : `${clamped.toFixed(0)}%`}
        </span>
        {detail && (
          <span className="truncate text-[11px] text-muted-foreground">
            {detail}
          </span>
        )}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${clamped ?? 0}%` }}
        />
      </div>
      {sparkline && sparkline.length > 1 && <MiniSparkline data={sparkline} />}
    </div>
  );
}

function MiniSparkline({ data }: { data: number[] }) {
  const w = 100;
  const h = 20;
  const max = 100;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - (Math.min(100, Math.max(0, v)) / max) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-5 w-full text-accent-brand/70">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function NodeSummaryStrip({
  node,
  histories,
}: {
  node: ProxmoxNodeStats | undefined;
  histories: { cpu: number[]; memory: number[]; disk: number[] };
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap gap-2">
      <Tile
        icon={<Cpu className="size-3.5" />}
        label={t("proxmoxStats.cpuUsage")}
        percent={node?.cpu.percent ?? null}
        detail={
          node?.cpu.cores != null
            ? t("proxmoxStats.cpuCores", { count: node.cpu.cores })
            : undefined
        }
        sparkline={histories.cpu}
      />
      <Tile
        icon={<MemoryStick className="size-3.5" />}
        label={t("proxmoxStats.memoryUsage")}
        percent={node?.memory.percent ?? null}
        detail={
          node?.memory.usedGiB != null && node?.memory.totalGiB != null
            ? `${node.memory.usedGiB.toFixed(1)} / ${node.memory.totalGiB.toFixed(1)} GiB`
            : undefined
        }
        sparkline={histories.memory}
      />
      <Tile
        icon={<HardDrive className="size-3.5" />}
        label={t("proxmoxStats.diskUsage")}
        percent={node?.disk.percent ?? null}
        detail={
          node?.disk.usedGiB != null && node?.disk.totalGiB != null
            ? `${node.disk.usedGiB.toFixed(1)} / ${node.disk.totalGiB.toFixed(1)} GiB`
            : undefined
        }
        sparkline={histories.disk}
      />
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="size-3.5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">
            {t("proxmoxStats.uptime")}
          </span>
        </div>
        <span className="text-2xl font-bold">
          {node?.uptime.formatted ?? "N/A"}
        </span>
        <div className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
          <Server className="size-3 shrink-0" />
          <span className="truncate">
            {node?.system.hostname ?? "-"}
            {node?.system.pveVersion ? ` · ${node.system.pveVersion}` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
