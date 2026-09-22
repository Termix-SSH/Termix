import type { GpuDevice } from "@/types/stats-widgets";

export interface GpuHistory {
  utilization: number[];
  memory: number[];
}

/** Live sparkline series keyed by GPU index. */
export type GpuHistories = Record<number, GpuHistory>;

/**
 * Appends one poll's readings to each GPU's series. GPUs missing from the poll
 * lose their series so a re-enumerated device never inherits stale samples.
 */
export function appendGpuHistories(
  prev: GpuHistories,
  gpus: GpuDevice[] | undefined,
  maxLength: number,
): GpuHistories {
  const add = (arr: number[] | undefined, v: number | null) =>
    [...(arr ?? []), v ?? 0].slice(-maxLength);

  const next: GpuHistories = {};
  for (const gpu of gpus ?? []) {
    next[gpu.index] = {
      utilization: add(prev[gpu.index]?.utilization, gpu.utilizationPercent),
      memory: add(prev[gpu.index]?.memory, gpu.memoryPercent),
    };
  }
  return next;
}
