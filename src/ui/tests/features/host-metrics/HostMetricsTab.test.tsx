import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ServerMetrics } from "@/main-axios";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

vi.mock("@/main-axios.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main-axios.ts")>()),
  getServerStatusById: vi.fn(async () => ({ status: "online" })),
  getServerMetricsById: vi.fn(async () => SAMPLE),
  startMetricsPolling: vi.fn(async () => ({ viewerSessionId: "viewer-1" })),
  stopMetricsPolling: vi.fn(async () => undefined),
  sendMetricsHeartbeat: vi.fn(async () => true),
  getSnippets: vi.fn(async () => []),
  getSSHHosts: vi.fn(async () => []),
  logActivity: vi.fn(async () => undefined),
}));

vi.mock("@/contexts/UiPreferencesContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/UiPreferencesContext")>()),
  useAreaPreferences: () => ({ columns: 3 }),
}));

vi.mock("@/hooks/use-confirmation.ts", () => ({
  useConfirmation: () => ({ confirmWithToast: vi.fn() }),
}));

vi.mock(
  "../../../features/host-metrics/hooks/useHostMetricsPreferences.ts",
  () => ({
    useHostMetricsPreferences: () => ({
      layout: {
        slots: [{ id: "gpu", order: 0, colSpan: 2, height: null }],
        columns: 3,
      },
      setLayout: vi.fn(),
      loaded: true,
    }),
  }),
);

import { HostMetricsTab } from "../../../features/host-metrics/HostMetricsTab";

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
          statsConfig: JSON.stringify({
            metricsEnabled: true,
            metricsInterval: 30,
            enabledWidgets: ["gpu"],
          }),
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
