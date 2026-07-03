import { Thermometer } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios";
import { StatRow } from "@/components/charts";
import { MetricCard } from "./MetricCard";

function formatTemperature(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(1)}°C`
    : "N/A";
}

export function TemperatureCard({
  metrics,
}: {
  metrics: ServerMetrics | null;
}) {
  const { t } = useTranslation();
  const temperature = metrics?.temperature;
  const sensors = temperature?.sensors ?? [];

  return (
    <MetricCard
      title={t("hostMetrics.temperature")}
      icon={<Thermometer className="size-3.5" />}
      scroll={sensors.length > 4}
      scrollMax={220}
    >
      <div className="flex flex-col gap-3">
        <div>
          <div className="text-3xl font-semibold tabular-nums">
            {formatTemperature(temperature?.highestCelsius)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t("hostMetrics.highestTemperature")}
          </div>
        </div>

        {sensors.length === 0 ? (
          <span className="text-xs text-muted-foreground">N/A</span>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {sensors.map((sensor) => (
              <StatRow
                key={`${sensor.label}-${sensor.celsius}`}
                label={sensor.label}
                value={formatTemperature(sensor.celsius)}
                mono
              />
            ))}
          </div>
        )}
      </div>
    </MetricCard>
  );
}
