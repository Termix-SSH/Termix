import { describe, expect, it } from "vitest";
import {
  selectTemperatureSensor,
  temperaturePreferenceKey,
} from "../../../features/host-metrics/temperature-preference";

const sensors = [
  { label: "k10temp: Tctl", celsius: 55 },
  { label: "nvme-pci-0100: Composite", celsius: 70 },
];

describe("temperature sensor preference", () => {
  it("selects the configured sensor by its complete label", () => {
    expect(selectTemperatureSensor(sensors, "k10temp: Tctl")).toEqual(
      sensors[0],
    );
  });

  it("falls back when a sensor disappears", () => {
    expect(selectTemperatureSensor(sensors, "missing")).toBeNull();
  });

  it("scopes the preference to a host", () => {
    expect(temperaturePreferenceKey(42)).toBe(
      "termix-host-metrics:42:temperature-sensor",
    );
  });
});
