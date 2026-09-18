import type { ServerMetrics } from "@/main-axios";

/**
 * Coarse fingerprint of a metrics poll. Adaptive polling backs off while it
 * stays the same, so it must move whenever something a card shows changes.
 */
export function metricsChangeKey(data: ServerMetrics): string {
  const bucket = (value: number | null | undefined) =>
    value == null ? null : Math.round(value / 5) * 5;
  return JSON.stringify({
    cpu: bucket(data.cpu.percent),
    memory: bucket(data.memory.percent),
    disk: bucket(data.disk.percent),
    running: data.processes?.running ?? null,
    ports: data.ports?.ports?.length ?? 0,
    firewall: data.firewall?.status ?? null,
    gpus:
      data.gpu?.gpus?.map((gpu) => [
        bucket(gpu.utilizationPercent),
        bucket(gpu.memoryPercent),
      ]) ?? [],
    gpuProcesses: data.gpu?.processes?.length ?? 0,
  });
}
