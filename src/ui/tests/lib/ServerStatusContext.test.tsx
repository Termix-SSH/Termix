import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const api = vi.hoisted(() => ({
  getAllServerStatuses: vi.fn(),
  hostStatusChecksOff: vi.fn(() => false),
}));
vi.mock("@/main-axios", () => api);

const {
  getLiveHostStatus,
  ServerStatusProvider,
  useHostStatus,
  useOptionalHostStatusEntry,
  useServerStatus,
  useServerStatusMeta,
} = await import("@/lib/ServerStatusContext");

const wrap =
  (isAuthenticated: boolean) =>
  ({ children }: { children: ReactNode }) => (
    <ServerStatusProvider isAuthenticated={isAuthenticated}>
      {children}
    </ServerStatusProvider>
  );

beforeEach(() => {
  api.getAllServerStatuses.mockReset();
  api.hostStatusChecksOff.mockReturnValue(false);
  api.getAllServerStatuses.mockResolvedValue({
    "1": { status: "online", lastChecked: "t" },
    "2": { status: "down" },
    nope: { status: "online" },
  });
});
afterEach(() => vi.useRealTimers());

describe("ServerStatusProvider", () => {
  it("loads statuses and maps anything but online to offline", async () => {
    const { result } = renderHook(
      () => ({
        all: useServerStatus(),
        one: useHostStatus(1),
        two: useHostStatus(2),
        off: useHostStatus(1, false),
        meta: useServerStatusMeta(),
        entry: useOptionalHostStatusEntry(1),
        missing: useOptionalHostStatusEntry(99),
      }),
      { wrapper: wrap(true) },
    );
    await waitFor(() => expect(result.current.one).toBe("online"));
    expect(result.current.two).toBe("offline");
    expect(result.current.off).toBeNull();
    expect(result.current.meta.initialLoadComplete).toBe(true);
    expect(result.current.entry).toEqual({ status: "online" });
    expect(result.current.missing).toBeNull();
    expect(result.current.all.getStatus(3)).toBe("unknown");
    expect(result.current.all.statuses.size).toBe(2);
    expect(getLiveHostStatus(1)).toBe("online");
  });

  it("reports no host as checking while nothing checks hosts", async () => {
    api.getAllServerStatuses.mockResolvedValue({});
    api.hostStatusChecksOff.mockReturnValue(true);
    const { result } = renderHook(
      () => ({
        all: useServerStatus(),
        one: useHostStatus(1),
        meta: useServerStatusMeta(),
      }),
      { wrapper: wrap(true) },
    );
    await waitFor(() => expect(result.current.meta.statusChecksOff).toBe(true));
    expect(result.current.one).toBeNull();
    expect(result.current.all.statusChecksOff).toBe(true);

    // A host status plugin turned on again brings the statuses back.
    api.hostStatusChecksOff.mockReturnValue(false);
    api.getAllServerStatuses.mockResolvedValue({
      "1": { status: "online", lastChecked: "t" },
    });
    await act(async () => {
      window.dispatchEvent(new Event("hosts:refresh"));
    });
    await waitFor(() => expect(result.current.one).toBe("online"));
    expect(result.current.meta.statusChecksOff).toBe(false);
  });

  it("refreshes on focus and when hosts change, and keeps old statuses on errors", async () => {
    const { result } = renderHook(() => useHostStatus(1), {
      wrapper: wrap(true),
    });
    await waitFor(() => expect(result.current).toBe("online"));
    const before = api.getAllServerStatuses.mock.calls.length;
    api.getAllServerStatuses.mockRejectedValueOnce(new Error("down"));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current).toBe("online");
    api.getAllServerStatuses.mockResolvedValue({ "1": { status: "offline" } });
    await act(async () => {
      window.dispatchEvent(new Event("hosts:refresh"));
    });
    await waitFor(() => expect(result.current).toBe("offline"));
    expect(api.getAllServerStatuses.mock.calls.length).toBeGreaterThan(before);
  });

  it("asks for nothing when signed out", async () => {
    const { result } = renderHook(() => useServerStatus(), {
      wrapper: wrap(false),
    });
    await act(async () => {
      await result.current.refreshStatuses();
    });
    expect(api.getAllServerStatuses).not.toHaveBeenCalled();
  });

  it("needs a provider for its hooks", () => {
    expect(() => renderHook(() => useServerStatus())).toThrow(
      "ServerStatusProvider",
    );
    expect(() => renderHook(() => useHostStatus(1))).toThrow(
      "ServerStatusProvider",
    );
    const { result } = renderHook(() => useOptionalHostStatusEntry(1));
    expect(result.current).toBeNull();
  });
});
