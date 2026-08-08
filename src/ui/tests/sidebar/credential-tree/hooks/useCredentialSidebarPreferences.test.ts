import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  getCredentialSidebarPreferences: vi.fn(),
  saveCredentialSidebarPreferences: vi.fn(async () => {}),
  getUserPreferences: vi.fn(async () => ({ storageMode: "local" })),
}));

vi.mock("@/main-axios", () => api);

import { useCredentialSidebarPreferences } from "../../../../sidebar/credential-tree/hooks/useCredentialSidebarPreferences";
import { defaultCredentialSidebarPreferences } from "@/types/credential-sidebar-preferences";

describe("useCredentialSidebarPreferences", () => {
  beforeEach(() => {
    localStorage.clear();
    api.getCredentialSidebarPreferences.mockReset();
    api.getCredentialSidebarPreferences.mockResolvedValue(
      defaultCredentialSidebarPreferences(),
    );
    api.saveCredentialSidebarPreferences.mockReset();
    api.saveCredentialSidebarPreferences.mockResolvedValue(undefined);
    api.getUserPreferences.mockReset();
    api.getUserPreferences.mockResolvedValue({ storageMode: "local" });
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("starts from defaults when there is no cache", () => {
    const { result } = renderHook(() => useCredentialSidebarPreferences());
    expect(result.current.preferences).toEqual(
      defaultCredentialSidebarPreferences(),
    );
    expect(result.current.loaded).toBe(false);
  });

  it("starts from the cached value for instant paint", () => {
    const cached = {
      ...defaultCredentialSidebarPreferences(),
      sort: { key: "manual" as const, pinnedFirst: false },
    };
    localStorage.setItem(
      "credentialSidebarPreferences",
      JSON.stringify(cached),
    );

    const { result } = renderHook(() => useCredentialSidebarPreferences());
    expect(result.current.preferences.sort.key).toBe("manual");
  });

  it("loads the authoritative copy from the server and marks loaded", async () => {
    const remote = {
      ...defaultCredentialSidebarPreferences(),
      sort: { key: "name-asc" as const, pinnedFirst: false },
    };
    api.getCredentialSidebarPreferences.mockResolvedValue(remote);

    const { result } = renderHook(() => useCredentialSidebarPreferences());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.preferences.sort.key).toBe("name-asc");
    expect(
      JSON.parse(localStorage.getItem("credentialSidebarPreferences")!),
    ).toEqual(remote);
  });

  it("keeps the cached value and still marks loaded when the fetch fails", async () => {
    api.getCredentialSidebarPreferences.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useCredentialSidebarPreferences());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.preferences).toEqual(
      defaultCredentialSidebarPreferences(),
    );
  });

  it("writes updates to the cache immediately", async () => {
    const { result } = renderHook(() => useCredentialSidebarPreferences());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.update((prev) => ({
        ...prev,
        display: { ...prev.display, density: "compact" },
      }));
    });

    expect(result.current.preferences.display.density).toBe("compact");
    expect(
      JSON.parse(localStorage.getItem("credentialSidebarPreferences")!).display
        .density,
    ).toBe("compact");
  });

  it("debounces the save and only pushes to the server in cloud storage mode", async () => {
    api.getUserPreferences.mockResolvedValue({ storageMode: "cloud" });
    const { result } = renderHook(() => useCredentialSidebarPreferences());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.update((prev) => ({
        ...prev,
        display: { ...prev.display, density: "compact" },
      }));
    });
    expect(api.saveCredentialSidebarPreferences).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(api.saveCredentialSidebarPreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          display: expect.objectContaining({ density: "compact" }),
        }),
      ),
    );
  });

  it("does not push to the server in local storage mode", async () => {
    const { result } = renderHook(() => useCredentialSidebarPreferences());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.update((prev) => ({
        ...prev,
        display: { ...prev.display, density: "compact" },
      }));
    });

    await waitFor(() => expect(api.getUserPreferences).toHaveBeenCalled());
    expect(api.saveCredentialSidebarPreferences).not.toHaveBeenCalled();
  });

  it("syncs an update made by one hook instance into a second mounted instance", async () => {
    const first = renderHook(() => useCredentialSidebarPreferences());
    const second = renderHook(() => useCredentialSidebarPreferences());
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    await waitFor(() => expect(second.result.current.loaded).toBe(true));

    act(() => {
      first.result.current.update((prev) => ({
        ...prev,
        display: { ...prev.display, density: "compact" },
      }));
    });

    expect(first.result.current.preferences.display.density).toBe("compact");
    await waitFor(() =>
      expect(second.result.current.preferences.display.density).toBe("compact"),
    );
  });

  it("sanitizes patches through the shared sanitizer", async () => {
    const { result } = renderHook(() => useCredentialSidebarPreferences());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.update({
        sort: {
          key: "not-a-real-key" as unknown as "default",
          pinnedFirst: false,
        },
      });
    });

    expect(result.current.preferences.sort.key).toBe("default");
  });
});
