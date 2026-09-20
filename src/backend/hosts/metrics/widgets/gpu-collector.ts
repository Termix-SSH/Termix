import type { Client } from "ssh2";
import { execCommand, toFixedNum } from "./common-utils.js";

export interface GpuDevice {
  index: number;
  uuid: string;
  name: string;
  driverVersion: string | null;
  utilizationPercent: number | null;
  memoryUsedMiB: number | null;
  memoryTotalMiB: number | null;
  memoryPercent: number | null;
  temperatureCelsius: number | null;
  powerDrawWatts: number | null;
  powerLimitWatts: number | null;
  fanPercent: number | null;
}

export interface GpuProcess {
  /** Null when nvidia-smi reports a uuid that matches none of the listed GPUs. */
  gpuIndex: number | null;
  pid: number;
  name: string;
  memoryUsedMiB: number | null;
}

export interface GpuMetrics {
  source: "nvidia-smi" | "none";
  gpus: GpuDevice[];
  processes: GpuProcess[];
}

const SECTION_SEPARATOR = "---";

// The free-text name is queried last so commas inside it cannot shift the
// numeric columns; the parsers rejoin everything past the fixed fields.
const GPU_QUERY_FIELDS = [
  "index",
  "uuid",
  "driver_version",
  "utilization.gpu",
  "memory.used",
  "memory.total",
  "temperature.gpu",
  "power.draw",
  "power.limit",
  "fan.speed",
  "name",
];
const APPS_QUERY_FIELDS = ["gpu_uuid", "pid", "used_memory", "process_name"];

const NVIDIA_SMI_COMMAND = [
  "command -v nvidia-smi >/dev/null 2>&1 || exit 0;",
  `nvidia-smi --query-gpu=${GPU_QUERY_FIELDS.join(",")} --format=csv,noheader,nounits 2>/dev/null;`,
  `echo ${SECTION_SEPARATOR};`,
  `nvidia-smi --query-compute-apps=${APPS_QUERY_FIELDS.join(",")} --format=csv,noheader,nounits 2>/dev/null`,
].join(" ");

const NO_GPU: GpuMetrics = { source: "none", gpus: [], processes: [] };

/** Reads a numeric field; nvidia-smi writes "[N/A]", "[Not Supported]" etc. for missing ones. */
function parseReading(raw: string | undefined, digits = 1): number | null {
  const value = raw?.trim();
  if (!value || value.startsWith("[")) return null;
  return toFixedNum(Number(value), digits);
}

function parseInteger(raw: string | undefined): number | null {
  const value = raw?.trim();
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

function splitCsvRow(line: string, fixedFields: number): string[] | null {
  const parts = line.split(",").map((part) => part.trim());
  if (parts.length <= fixedFields) return null;
  return [...parts.slice(0, fixedFields), parts.slice(fixedFields).join(", ")];
}

export function parseNvidiaSmiGpus(output: string): GpuDevice[] {
  const fixedFields = GPU_QUERY_FIELDS.length - 1;
  const gpus: GpuDevice[] = [];

  for (const line of output.split("\n")) {
    const row = splitCsvRow(line, fixedFields);
    if (!row) continue;

    const [
      rawIndex,
      uuid,
      driverVersion,
      utilization,
      memoryUsed,
      memoryTotal,
      temperature,
      powerDraw,
      powerLimit,
      fan,
      name,
    ] = row;
    const index = parseInteger(rawIndex);
    if (index === null || !uuid) continue;

    const memoryUsedMiB = parseReading(memoryUsed, 0);
    const memoryTotalMiB = parseReading(memoryTotal, 0);

    gpus.push({
      index,
      uuid,
      name,
      driverVersion:
        driverVersion && !driverVersion.startsWith("[") ? driverVersion : null,
      utilizationPercent: parseReading(utilization),
      memoryUsedMiB,
      memoryTotalMiB,
      memoryPercent:
        memoryUsedMiB !== null &&
        memoryTotalMiB !== null &&
        memoryTotalMiB !== 0
          ? toFixedNum((memoryUsedMiB / memoryTotalMiB) * 100, 1)
          : null,
      temperatureCelsius: parseReading(temperature),
      powerDrawWatts: parseReading(powerDraw),
      powerLimitWatts: parseReading(powerLimit),
      fanPercent: parseReading(fan),
    });
  }

  return gpus;
}

export function parseNvidiaSmiProcesses(
  output: string,
  gpus: GpuDevice[],
): GpuProcess[] {
  const indexByUuid = new Map(gpus.map((gpu) => [gpu.uuid, gpu.index]));
  const processes: GpuProcess[] = [];

  for (const line of output.split("\n")) {
    const row = splitCsvRow(line, APPS_QUERY_FIELDS.length - 1);
    if (!row) continue;

    const [uuid, rawPid, memoryUsed, name] = row;
    const pid = parseInteger(rawPid);
    if (pid === null) continue;

    processes.push({
      gpuIndex: indexByUuid.get(uuid) ?? null,
      pid,
      name,
      memoryUsedMiB: parseReading(memoryUsed, 0),
    });
  }

  return processes;
}

export function parseNvidiaSmiOutput(stdout: string): GpuMetrics {
  const lines = stdout.split("\n");
  const separator = lines.findIndex(
    (line) => line.trim() === SECTION_SEPARATOR,
  );
  const gpuSection =
    separator === -1 ? stdout : lines.slice(0, separator).join("\n");
  const appsSection =
    separator === -1 ? "" : lines.slice(separator + 1).join("\n");

  const gpus = parseNvidiaSmiGpus(gpuSection);
  if (gpus.length === 0) return NO_GPU;

  return {
    source: "nvidia-smi",
    gpus,
    processes: parseNvidiaSmiProcesses(appsSection, gpus),
  };
}

export async function collectGpuMetrics(client: Client): Promise<GpuMetrics> {
  try {
    // nvidia-smi can take a few seconds on hosts without persistence mode.
    const result = await execCommand(client, NVIDIA_SMI_COMMAND, 15000);
    return parseNvidiaSmiOutput(result.stdout);
  } catch {
    // expected when the host has no NVIDIA driver or the query times out
    return NO_GPU;
  }
}
