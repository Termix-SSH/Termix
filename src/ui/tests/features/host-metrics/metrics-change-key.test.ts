import { describe, expect, it } from "vitest";
import type { ServerMetrics } from "@/main-axios";
import type { GpuMetrics } from "@/types/stats-widgets";
import { metricsChangeKey } from "../../../features/host-metrics/metrics-change-key";

function poll(gpu: GpuMetrics): ServerMetrics {
  return {
    cpu: { percent: 3, cores: 8, load: [0.1, 0.1, 0.1] },
    memory: { percent: 40, usedGiB: 12, totalGiB: 32 },
    disk: { percent: 55 },
    gpu,
    lastChecked: "2026-09-18T00:00:00.000Z",
  } as ServerMetrics;
}

function gpuAt(utilizationPercent: number, memoryPercent: number): GpuMetrics {
  return {
    source: "nvidia-smi",
    gpus: [
      {
        index: 0,
        uuid: "GPU-0",
        name: "NVIDIA GeForce RTX 4090",
        driverVersion: "550.54.14",
        utilizationPercent,
        memoryUsedMiB: 1000,
        memoryTotalMiB: 24564,
        memoryPercent,
        temperatureCelsius: 50,
        powerDrawWatts: 30,
        powerLimitWatts: 450,
        fanPercent: 30,
      },
    ],
    processes: [],
  };
}

describe("metricsChangeKey", () => {
  it("changes when only GPU utilization moves", () => {
    expect(metricsChangeKey(poll(gpuAt(0, 4)))).not.toBe(
      metricsChangeKey(poll(gpuAt(95, 4))),
    );
  });

  it("changes when only GPU memory moves", () => {
    expect(metricsChangeKey(poll(gpuAt(0, 4)))).not.toBe(
      metricsChangeKey(poll(gpuAt(0, 80))),
    );
  });

  it("changes when a GPU process starts", () => {
    const idle = gpuAt(0, 4);
    const busy: GpuMetrics = {
      ...idle,
      processes: [
        { gpuIndex: 0, pid: 4242, name: "python3", memoryUsedMiB: 900 },
      ],
    };

    expect(metricsChangeKey(poll(idle))).not.toBe(metricsChangeKey(poll(busy)));
  });

  it("ignores GPU jitter inside the same 5% bucket", () => {
    expect(metricsChangeKey(poll(gpuAt(41, 20)))).toBe(
      metricsChangeKey(poll(gpuAt(42, 21))),
    );
  });
});
