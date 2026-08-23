import type { TemperatureSensor } from "@/types/stats-widgets";

export function selectTemperatureSensor(
  sensors: TemperatureSensor[],
  preferredLabel: string,
) {
  return sensors.find((sensor) => sensor.label === preferredLabel) ?? null;
}

export function temperaturePreferenceKey(hostId: number) {
  return `termix-host-metrics:${hostId}:temperature-sensor`;
}
