import type { Client } from "ssh2";
import { execCommand, toFixedNum } from "./common-utils.js";

export interface TemperatureSensor {
  label: string;
  celsius: number;
}

export interface TemperatureMetrics {
  source: "sysfs" | "sensors" | "none";
  highestCelsius: number | null;
  sensors: TemperatureSensor[];
}

function normalizeSensor(
  label: string,
  celsius: number,
): TemperatureSensor | null {
  const cleanLabel = label.trim().replace(/\s+/g, " ");
  if (!cleanLabel || !Number.isFinite(celsius)) return null;
  return {
    label: cleanLabel,
    celsius: toFixedNum(celsius, 1) ?? celsius,
  };
}

function summarizeSensors(
  source: TemperatureMetrics["source"],
  sensors: TemperatureSensor[],
): TemperatureMetrics {
  const highest = sensors.reduce<number | null>(
    (max, sensor) =>
      max === null ? sensor.celsius : Math.max(max, sensor.celsius),
    null,
  );

  return {
    source: sensors.length > 0 ? source : "none",
    highestCelsius:
      highest === null ? null : (toFixedNum(highest, 1) ?? highest),
    sensors,
  };
}

export function parseSysfsThermalOutput(output: string): TemperatureSensor[] {
  return output
    .split("\n")
    .map((line) => {
      const [label, rawValue] = line.split("\t");
      const value = Number(rawValue);
      if (!label || !Number.isFinite(value)) return null;
      const celsius = Math.abs(value) >= 1000 ? value / 1000 : value;
      return normalizeSensor(label, celsius);
    })
    .filter((sensor): sensor is TemperatureSensor => sensor !== null);
}

export function parseSensorsOutput(output: string): TemperatureSensor[] {
  const seen = new Set<string>();
  const sensors: TemperatureSensor[] = [];

  for (const line of output.split("\n")) {
    const match = line.match(/^\s*([^:]+):\s*([+-]?\d+(?:\.\d+)?)\s*°?C\b/i);
    if (!match) continue;

    const sensor = normalizeSensor(match[1], Number(match[2]));
    if (!sensor) continue;

    const key = `${sensor.label.toLowerCase()}:${sensor.celsius}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sensors.push(sensor);
  }

  return sensors;
}

export async function collectTemperatureMetrics(
  client: Client,
): Promise<TemperatureMetrics> {
  try {
    const sysfs = await execCommand(
      client,
      [
        "for zone in /sys/class/thermal/thermal_zone*; do",
        '[ -r "$zone/temp" ] || continue;',
        'label="$(cat "$zone/type" 2>/dev/null || basename "$zone")";',
        'value="$(cat "$zone/temp" 2>/dev/null || true)";',
        '[ -n "$value" ] && printf "%s\\t%s\\n" "$label" "$value";',
        "done",
      ].join(" "),
      10000,
    );
    const sensors = parseSysfsThermalOutput(sysfs.stdout);
    if (sensors.length > 0) {
      return summarizeSensors("sysfs", sensors);
    }
  } catch {
    // expected on systems without readable thermal zones
  }

  try {
    const lmSensors = await execCommand(client, "sensors 2>/dev/null", 10000);
    const sensors = parseSensorsOutput(lmSensors.stdout);
    if (sensors.length > 0) {
      return summarizeSensors("sensors", sensors);
    }
  } catch {
    // expected when lm-sensors is not installed
  }

  return {
    source: "none",
    highestCelsius: null,
    sensors: [],
  };
}
