import type { TemperatureSensor } from "../shared/stats-widgets.js";

export type TemperatureUnit = "celsius" | "fahrenheit";

export function selectTemperatureSensor(
  sensors: TemperatureSensor[],
  preferredLabel: string,
) {
  return sensors.find((sensor) => sensor.label === preferredLabel) ?? null;
}

/** The sensor a person picked is remembered per browser. */
export function temperaturePreferenceKey(hostId: number) {
  return `termix-host-metrics:${hostId}:temperature-sensor`;
}

/** The temperatureUnit user setting, celsius for anything else. */
export function temperatureUnitOf(value: unknown): TemperatureUnit {
  return value === "fahrenheit" ? "fahrenheit" : "celsius";
}

export function formatTemperature(
  celsius: number | null | undefined,
  unit: TemperatureUnit = "celsius",
): string {
  if (typeof celsius !== "number" || !Number.isFinite(celsius)) return "N/A";
  return unit === "fahrenheit"
    ? `${((celsius * 9) / 5 + 32).toFixed(1)}°F`
    : `${celsius.toFixed(1)}°C`;
}
