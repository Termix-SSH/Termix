import { describe, expect, it } from "vitest";
import type { GpuDevice } from "@/types/stats-widgets";
import { appendGpuHistories } from "../../../features/host-metrics/cards/gpu-history";

function gpu(
  index: number,
  utilizationPercent: number | null,
  memoryPercent: number | null,
): GpuDevice {
  return {
    index,
    uuid: `GPU-${index}`,
    name: `GPU ${index}`,
    driverVersion: "550.54.14",
    utilizationPercent,
    memoryUsedMiB: null,
    memoryTotalMiB: null,
    memoryPercent,
    temperatureCelsius: null,
    powerDrawWatts: null,
    powerLimitWatts: null,
    fanPercent: null,
  };
}

describe("appendGpuHistories", () => {
  it("records utilization and memory in a separate series per GPU", () => {
    const first = appendGpuHistories({}, [gpu(0, 10, 20), gpu(1, 90, 5)], 30);
    const second = appendGpuHistories(
      first,
      [gpu(0, 15, 25), gpu(1, 80, 6)],
      30,
    );

    expect(second).toEqual({
      0: { utilization: [10, 15], memory: [20, 25] },
      1: { utilization: [90, 80], memory: [5, 6] },
    });
  });

  it("keeps only the newest samples once the series is full", () => {
    let histories = {};
    for (const value of [1, 2, 3, 4]) {
      histories = appendGpuHistories(histories, [gpu(0, value, value)], 3);
    }

    expect(histories).toEqual({
      0: { utilization: [2, 3, 4], memory: [2, 3, 4] },
    });
  });

  it("records an unavailable reading as zero", () => {
    expect(appendGpuHistories({}, [gpu(0, null, null)], 30)).toEqual({
      0: { utilization: [0], memory: [0] },
    });
  });

  it("drops the series of a GPU that is no longer reported", () => {
    const before = appendGpuHistories({}, [gpu(0, 10, 10), gpu(1, 20, 20)], 30);

    expect(appendGpuHistories(before, [gpu(0, 11, 11)], 30)).toEqual({
      0: { utilization: [10, 11], memory: [10, 11] },
    });
    expect(appendGpuHistories(before, undefined, 30)).toEqual({});
  });
});
