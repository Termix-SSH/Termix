import { afterEach, describe, expect, it, vi } from "vitest";
import { createMetricsSummaryStore } from "../../src/frontend/summary-store";
import type { HostMetricsApi } from "../../src/frontend/host-metrics-api";

afterEach(() => {
  vi.useRealTimers();
});

function fakeApi() {
  return {
    registerViewer: vi.fn(async () => ({
      success: true,
      viewerSessionId: "v1",
    })),
    unregisterViewer: vi.fn(async () => undefined),
    heartbeat: vi.fn(async () => true),
    getMetrics: vi.fn(async () => ({ cpu: { percent: 5 } })),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("metrics summary store", () => {
  it("holds one viewer per host while anything watches it", async () => {
    const api = fakeApi();
    const store = createMetricsSummaryStore(api as unknown as HostMetricsApi);
    const listener = vi.fn();

    const first = store.watch(7, listener);
    const second = store.watch(7, vi.fn());
    await flush();

    expect(api.registerViewer).toHaveBeenCalledOnce();
    expect(store.get(7)).toEqual({ cpu: { percent: 5 } });
    expect(listener).toHaveBeenCalled();

    first();
    expect(api.unregisterViewer).not.toHaveBeenCalled();
    second();
    expect(api.unregisterViewer).toHaveBeenCalledWith(7, "v1");
    expect(store.get(7)).toBeNull();
  });

  it("registers again when the server dropped the viewer", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const store = createMetricsSummaryStore(api as unknown as HostMetricsApi);
    store.watch(7, vi.fn());
    await vi.advanceTimersByTimeAsync(0);

    api.heartbeat.mockResolvedValueOnce(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.registerViewer).toHaveBeenCalledTimes(2);
    store.dispose();
  });
});
