import { Thermometer } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios";
import { StatRow } from "@/components/charts";
import { MetricCard } from "./MetricCard";
import { useEffect, useState } from "react";
import {
  selectTemperatureSensor,
  temperaturePreferenceKey,
} from "../temperature-preference";

function formatTemperature(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(1)}°C`
    : "N/A";
}

export function TemperatureCard({
  metrics,
  hostId,
}: {
  metrics: ServerMetrics | null;
  hostId: number | null;
}) {
  const { t } = useTranslation();
  const temperature = metrics?.temperature;
  const sensors = temperature?.sensors ?? [];
  const [preferredLabel, setPreferredLabel] = useState("");

  useEffect(() => {
    setPreferredLabel(
      hostId === null
        ? ""
        : (localStorage.getItem(temperaturePreferenceKey(hostId)) ?? ""),
    );
  }, [hostId]);

  const preferredSensor = selectTemperatureSensor(sensors, preferredLabel);
  const displayedTemperature =
    preferredSensor?.celsius ?? temperature?.highestCelsius;
  const displayedLabel =
    preferredSensor?.label ?? t("hostMetrics.highestTemperature");

  const chooseSensor = (label: string) => {
    setPreferredLabel(label);
    if (hostId === null) return;
    const key = temperaturePreferenceKey(hostId);
    if (label) localStorage.setItem(key, label);
    else localStorage.removeItem(key);
  };

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
            {formatTemperature(displayedTemperature)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {displayedLabel}
          </div>
        </div>

        {sensors.length > 1 && (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>{t("hostMetrics.primaryTemperatureSensor")}</span>
            <select
              value={preferredSensor?.label ?? ""}
              onChange={(event) => chooseSensor(event.target.value)}
              className="h-8 border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">{t("hostMetrics.highestTemperature")}</option>
              {sensors.map((sensor) => (
                <option key={sensor.label} value={sensor.label}>
                  {sensor.label}
                </option>
              ))}
            </select>
          </label>
        )}

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
