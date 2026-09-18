import { useId } from "react";
import { Gpu } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios";
import type { GpuDevice, GpuProcess } from "@/types/stats-widgets";
import { MiniStat, RadialGauge, Sparkline, StatRow } from "@/components/charts";
import { MetricCard } from "./MetricCard";
import type { GpuHistories, GpuHistory } from "./gpu-history";

const NA = "N/A";
const EMPTY_HISTORY: GpuHistory = { utilization: [], memory: [] };

function formatGiB(mib: number | null): string {
  return mib === null ? NA : (mib / 1024).toFixed(1);
}

function formatVram(gpu: GpuDevice): string {
  return gpu.memoryUsedMiB === null || gpu.memoryTotalMiB === null
    ? NA
    : `${formatGiB(gpu.memoryUsedMiB)}/${formatGiB(gpu.memoryTotalMiB)}G`;
}

function formatWhole(value: number | null, unit: string): string {
  return value === null ? NA : `${Math.round(value)}${unit}`;
}

function formatPower(gpu: GpuDevice): string {
  if (gpu.powerDrawWatts === null && gpu.powerLimitWatts === null) return NA;
  return `${formatWhole(gpu.powerDrawWatts, "")}/${formatWhole(gpu.powerLimitWatts, "")}W`;
}

function processVram(process: GpuProcess): string {
  const vram =
    process.memoryUsedMiB === null
      ? NA
      : `${formatGiB(process.memoryUsedMiB)}G`;
  return process.gpuIndex === null ? vram : `${vram} · GPU ${process.gpuIndex}`;
}

function executableName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** A captioned 0-100% sparkline, so the two trends under each GPU are told apart. */
function TrendSparkline({
  caption,
  data,
  colorClassName,
}: {
  caption: string;
  data: number[];
  colorClassName?: string;
}) {
  const captionId = useId();

  return (
    <figure aria-labelledby={captionId} className="flex min-w-0 flex-col gap-1">
      <figcaption
        id={captionId}
        className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
      >
        {caption}
      </figcaption>
      <Sparkline
        data={data}
        domain={[0, 100]}
        height={36}
        colorClassName={colorClassName}
      />
    </figure>
  );
}

function GpuDeviceRow({
  gpu,
  history,
}: {
  gpu: GpuDevice;
  history: GpuHistory;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-baseline gap-1.5 text-xs">
        <span className="font-mono text-muted-foreground">#{gpu.index}</span>
        <span className="truncate font-semibold">{gpu.name}</span>
      </div>
      <div className="flex items-center gap-4">
        <RadialGauge
          value={gpu.utilizationPercent}
          size={96}
          caption={t("hostMetrics.gpu.utilization")}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat
              caption={t("hostMetrics.gpu.memory")}
              value={formatVram(gpu)}
            />
            <MiniStat
              caption={t("hostMetrics.gpu.temperature")}
              value={formatWhole(gpu.temperatureCelsius, "°C")}
            />
            <MiniStat
              caption={t("hostMetrics.gpu.power")}
              value={formatPower(gpu)}
            />
            <MiniStat
              caption={t("hostMetrics.gpu.fan")}
              value={formatWhole(gpu.fanPercent, "%")}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TrendSparkline
              caption={t("hostMetrics.gpu.utilization")}
              data={[...history.utilization, gpu.utilizationPercent ?? 0]}
            />
            <TrendSparkline
              caption={t("hostMetrics.gpu.memory")}
              data={[...history.memory, gpu.memoryPercent ?? 0]}
              colorClassName="text-muted-foreground"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function GpuCard({
  metrics,
  gpuHistories,
}: {
  metrics: ServerMetrics | null;
  gpuHistories: GpuHistories;
}) {
  const { t } = useTranslation();
  const gpus = metrics?.gpu?.gpus ?? [];
  const processes = metrics?.gpu?.processes ?? [];
  const driverVersion = gpus[0]?.driverVersion;

  return (
    <MetricCard
      title={t("hostMetrics.gpu.title")}
      icon={<Gpu className="size-3.5" />}
      action={
        driverVersion ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            {t("hostMetrics.gpu.driver", { version: driverVersion })}
          </span>
        ) : undefined
      }
      scroll={gpus.length > 2 || processes.length > 6}
      scrollMax={520}
    >
      {gpus.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          {t("hostMetrics.gpu.noDevice")}
        </span>
      ) : (
        <div className="flex flex-col gap-4">
          {gpus.map((gpu) => (
            <GpuDeviceRow
              key={gpu.index}
              gpu={gpu}
              history={gpuHistories[gpu.index] ?? EMPTY_HISTORY}
            />
          ))}

          <div className="flex flex-col">
            <span className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hostMetrics.gpu.processes")}
            </span>
            {processes.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                {t("hostMetrics.gpu.noProcesses")}
              </span>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {processes.map((process) => (
                  <StatRow
                    key={`${process.gpuIndex}-${process.pid}`}
                    label={
                      <span className="flex items-baseline gap-1.5">
                        <span title={process.name} className="text-foreground">
                          {executableName(process.name)}
                        </span>
                        <span className="font-mono text-[10px]">
                          {process.pid}
                        </span>
                      </span>
                    }
                    value={processVram(process)}
                    mono
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </MetricCard>
  );
}
