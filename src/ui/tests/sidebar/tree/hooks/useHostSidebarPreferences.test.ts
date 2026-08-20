import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  getHostSidebarPreferences: vi.fn(),
  saveHostSidebarPreferences: vi.fn(async () => {}),
  getUserPreferences: vi.fn(async () => ({ storageMode: "local" })),
}));

vi.mock("@/main-axios", () => api);

import { useHostSidebarPreferences } from "../../../../sidebar/tree/hooks/useHostSidebarPreferences";
import { defaultHostSidebarPreferences } from "@/types/host-sidebar-preferences";

describe("useHostSidebarPreferences", () => {
  beforeEach(() => {
    localStorage.clear();
    api.getHostSidebarPreferences.mockReset();
    api.getHostSidebarPreferences.mockResolvedValue(
      defaultHostSidebarPreferences(),
    );
    api.saveHostSidebarPreferences.mockReset();
    api.saveHostSidebarPreferences.mockResolvedValue(undefined);
    api.getUserPreferences.mockReset();
    api.getUserPreferences.mockResolvedValue({ storageMode: "local" });
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("starts from defaults when there is no cache", () => {
    const { result } = renderHook(() => useHostSidebarPreferences());
    expect(result.current.preferences).toEqual(defaultHostSidebarPreferences());
    expect(result.current.loaded).toBe(false);
  });

  it("starts from the cached value for instant paint", () => {
    const cached = {
      ...defaultHostSidebarPreferences(),
      groupKey: "tag" as const,
    };
    localStorage.setItem("hostSidebarPreferences", JSON.stringify(cached));

    const { result } = renderHook(() => useHostSidebarPreferences());
    expect(result.current.preferences.groupKey).toBe("tag");
  });

  it("loads the authoritative copy from the server and marks loaded", async () => {
    const remote = {
      ...defaultHostSidebarPreferences(),
      groupKey: "status" as const,
    };
    api.getHostSidebarPreferences.mockResolvedValue(remote);

    const { result } = renderHook(() => useHostSidebarPreferences());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.preferences.groupKey).toBe("status");
    expect(JSON.parse(localStorage.getItem("hostSidebarPreferences")!)).toEqual(
      remote,
    );
  });

  it("keeps the cached value and still marks loaded when the fetch fails", async () => {
    api.getHostSidebarPreferences.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useHostSidebarPreferences());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.preferences).toEqual(defaultHostSidebarPreferences());
  });

  it("writes updates to the cache immediately", async () => {
    const { result } = renderHook(() => useHostSidebarPreferences());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.update({ groupKey: "protocol" });
    });

    expect(result.current.preferences.groupKey).toBe("protocol");
    expect(
      JSON.parse(localStorage.getItem("hostSidebarPreferences")!).groupKey,
    ).toBe("protocol");
  });

  it("debounces the save and only pushes to the server in cloud storage mode", async () => {
    api.getUserPreferences.mockResolvedValue({ storageMode: "cloud" });
    const { result } = renderHook(() => useHostSidebarPreferences());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.update({ groupKey: "auth" });
    });
    expect(api.saveHostSidebarPreferences).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(api.saveHostSidebarPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ groupKey: "auth" }),
      ),
    );
  });

  it("does not push to the server in local storage mode", async () => {
    const { result } = renderHook(() => useHostSidebarPreferences());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.update({ groupKey: "auth" });
    });

    await waitFor(() => expect(api.getUserPreferences).toHaveBeenCalled());
    expect(api.saveHostSidebarPreferences).not.toHaveBeenCalled();
  });

  it("syncs an update made by one hook instance into a second mounted instance", async () => {
    const first = renderHook(() => useHostSidebarPreferences());
    const second = renderHook(() => useHostSidebarPreferences());
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    await waitFor(() => expect(second.result.current.loaded).toBe(true));

    act(() => {
      first.result.current.update({ groupKey: "protocol" });
    });

    expect(first.result.current.preferences.groupKey).toBe("protocol");
    await waitFor(() =>
      expect(second.result.current.preferences.groupKey).toBe("protocol"),
    );
  });

  it("sanitizes patches through the shared sanitizer", async () => {
    const { result } = renderHook(() => useHostSidebarPreferences());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.update({
        groupKey: "not-a-real-key" as unknown as "folder",
      });
    });

    expect(result.current.preferences.groupKey).toBe("folder");
  });
});
