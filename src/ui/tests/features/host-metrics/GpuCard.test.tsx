import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ServerMetrics } from "@/main-axios";
import type { GpuMetrics } from "@/types/stats-widgets";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { GpuCard } from "../../../features/host-metrics/cards/GpuCard";

const GPU_METRICS: GpuMetrics = {
  source: "nvidia-smi",
  gpus: [
    {
      index: 0,
      uuid: "GPU-rtx",
      name: "NVIDIA GeForce RTX 4090",
      driverVersion: "550.54.14",
      utilizationPercent: 37,
      memoryUsedMiB: 8123,
      memoryTotalMiB: 24564,
      memoryPercent: 33.1,
      temperatureCelsius: 61,
      powerDrawWatts: 182.4,
      powerLimitWatts: 450,
      fanPercent: 45,
    },
    {
      index: 1,
      uuid: "GPU-h100",
      name: "NVIDIA H100 80GB HBM3",
      driverVersion: "550.54.14",
      utilizationPercent: 0,
      memoryUsedMiB: 1,
      memoryTotalMiB: 81559,
      memoryPercent: 0,
      temperatureCelsius: 34,
      powerDrawWatts: null,
      powerLimitWatts: 700,
      fanPercent: null,
    },
  ],
  processes: [
    {
      gpuIndex: 0,
      pid: 12345,
      name: "/usr/bin/python3",
      memoryUsedMiB: 7890,
    },
    { gpuIndex: 1, pid: 23456, name: "worker", memoryUsedMiB: null },
  ],
};

function renderCard(gpu: GpuMetrics | undefined, gpuHistories = {}) {
  const metrics = { gpu } as ServerMetrics;
  render(<GpuCard metrics={metrics} gpuHistories={gpuHistories} />);
}

afterEach(cleanup);

describe("GpuCard", () => {
  it("explains that no NVIDIA GPU was found", () => {
    renderCard({ source: "none", gpus: [], processes: [] });

    expect(screen.getByText("hostMetrics.gpu.noDevice")).toBeInTheDocument();
  });

  it("treats metrics from a backend without gpu support as no GPU", () => {
    renderCard(undefined);

    expect(screen.getByText("hostMetrics.gpu.noDevice")).toBeInTheDocument();
  });

  it("shows the readings of every GPU", () => {
    renderCard(GPU_METRICS);

    expect(screen.getByText("NVIDIA GeForce RTX 4090")).toBeInTheDocument();
    expect(screen.getByText("NVIDIA H100 80GB HBM3")).toBeInTheDocument();
    expect(screen.getByText("7.9/24.0G")).toBeInTheDocument();
    expect(screen.getByText("0.0/79.6G")).toBeInTheDocument();
    expect(screen.getByText("61°C")).toBeInTheDocument();
    expect(screen.getByText("182/450W")).toBeInTheDocument();
    expect(screen.getByText("N/A/700W")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.queryByText("hostMetrics.gpu.noDevice")).toBeNull();
  });

  it("draws each GPU's history as labelled utilization and VRAM trends", () => {
    renderCard(
      { ...GPU_METRICS, gpus: [GPU_METRICS.gpus[0]] },
      { 0: { utilization: [10, 20], memory: [30, 31] } },
    );

    for (const name of [
      "hostMetrics.gpu.utilization",
      "hostMetrics.gpu.memory",
    ]) {
      const trend = screen.getByRole("figure", { name });
      expect(trend.querySelector("svg")).not.toBeNull();
    }
  });

  it("lists GPU processes by executable name with the GPU and VRAM they hold", () => {
    renderCard(GPU_METRICS);

    const python = screen.getByText("python3");
    expect(python).toHaveAttribute("title", "/usr/bin/python3");
    expect(screen.getByText("7.7G · GPU 0")).toBeInTheDocument();
    expect(screen.getByText("N/A · GPU 1")).toBeInTheDocument();
  });

  it("says so when no process is using a GPU", () => {
    renderCard({ ...GPU_METRICS, processes: [] });

    expect(screen.getByText("hostMetrics.gpu.noProcesses")).toBeInTheDocument();
  });
});
