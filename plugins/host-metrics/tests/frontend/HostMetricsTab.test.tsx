import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ServerMetrics } from "../../src/shared/metrics.js";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const SAMPLE = {
  cpu: { percent: 12, cores: 8, load: [0.5, 0.4, 0.3] },
  memory: { percent: 40, usedGiB: 12.8, totalGiB: 32 },
  disk: { percent: 55 },
  gpu: {
    source: "nvidia-smi",
    gpus: [
      {
        index: 0,
        uuid: "GPU-0",
        name: "NVIDIA GeForce RTX 2070 SUPER",
        driverVersion: "580.173.02",
        utilizationPercent: 0,
        memoryUsedMiB: 5689,
        memoryTotalMiB: 8192,
        memoryPercent: 69.4,
        temperatureCelsius: 35,
        powerDrawWatts: 24,
        powerLimitWatts: 215,
        fanPercent: 0,
      },
    ],
    processes: [],
  },
  lastChecked: "2026-09-18T07:00:00.000Z",
} as ServerMetrics;

vi.mock("../../src/frontend/host-metrics-api", async (importOriginal) => {
  const api = {
    getMetrics: vi.fn(async () => SAMPLE),
    startMetrics: vi.fn(async () => ({
      success: true,
      viewerSessionId: "viewer-1",
    })),
    stopMetrics: vi.fn(async () => undefined),
    heartbeat: vi.fn(async () => true),
    submitTotp: vi.fn(),
  };
  return {
    ...(await importOriginal<object>()),
    useHostMetricsApi: () => api,
  };
});

vi.mock("@termix/plugin-sdk/ui", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAreaPreferences: () => ({ columns: 3 }),
  useConfirmation: () => ({ confirmWithToast: vi.fn() }),
  logActivity: vi.fn(async () => undefined),
}));

vi.mock("../../src/frontend/hooks/useHostMetricsPreferences.ts", () => ({
  useHostMetricsPreferences: () => ({
    layout: {
      slots: [{ id: "gpu", order: 0, colSpan: 2, height: null }],
      columns: 3,
    },
    setLayout: vi.fn(),
    loaded: true,
  }),
}));

import { HostMetricsTab } from "../../src/frontend/HostMetricsTab";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

describe("HostMetricsTab", () => {
  it("draws the trend lines from the first metrics sample, before the next poll", async () => {
    render(
      <HostMetricsTab
        hostConfig={{
          id: 1,
          name: "gpu-box",
          ip: "10.0.0.5",
          username: "admin",
          port: 22,
          authType: "password",
          pluginSettings: {
            "host-metrics": {
              metricsEnabled: true,
              metricsInterval: 30,
              enabledWidgets: ["gpu"],
            },
          },
        }}
      />,
    );

    const trend = await screen.findByRole(
      "figure",
      { name: "hostMetrics.gpu.memory" },
      { timeout: 5000 },
    );
    expect(trend.querySelector("svg")).not.toBeNull();
  });
});
