import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const api = vi.hoisted(() => ({
  getUiPreferences: vi.fn(),
  saveUiPreferences: vi.fn(async () => {}),
  getUserPreferences: vi.fn(async () => ({ storageMode: "local" })),
}));

vi.mock("@/main-axios", () => api);

import {
  UiPreferencesProvider,
  useAreaPreferences,
  useUiPreferencesContext,
} from "@/contexts/UiPreferencesContext";
import { defaultUiPreferences, PRESETS } from "@/types/ui-preferences";

function wrapper({ children }: { children: ReactNode }) {
  return <UiPreferencesProvider>{children}</UiPreferencesProvider>;
}

beforeEach(() => {
  localStorage.clear();
  api.getUiPreferences.mockReset();
  api.saveUiPreferences.mockReset();
  api.getUserPreferences.mockReset();
  api.getUiPreferences.mockResolvedValue(defaultUiPreferences());
  api.saveUiPreferences.mockResolvedValue(undefined);
  api.getUserPreferences.mockResolvedValue({ storageMode: "local" });
});

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("useAreaPreferences", () => {
  it("falls back to balanced outside a provider so isolated renders match today", () => {
    const { result } = renderHook(() => useAreaPreferences("hostList"));
    expect(result.current).toEqual(PRESETS.balanced.hostList);
  });

  it("resolves preset values through the provider", async () => {
    api.getUiPreferences.mockResolvedValue({
      ...defaultUiPreferences(),
      preset: "simple",
    });

    const { result } = renderHook(() => useAreaPreferences("hostList"), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.trayTrigger).toBe(
        PRESETS.simple.hostList.trayTrigger,
      ),
    );
    expect(result.current.showResourceBars).toBe(false);
  });

  it("layers overrides over the preset", async () => {
    api.getUiPreferences.mockResolvedValue({
      ...defaultUiPreferences(),
      preset: "simple",
      overrides: { hostList: { showResourceBars: true } },
    });

    const { result } = renderHook(() => useAreaPreferences("hostList"), {
      wrapper,
    });

    // Wait on a value only the loaded state has -- showResourceBars:true is
    // also balanced's value, so asserting it first can pass pre-fetch.
    await waitFor(() =>
      expect(result.current.trayTrigger).toBe(
        PRESETS.simple.hostList.trayTrigger,
      ),
    );
    expect(result.current.showResourceBars).toBe(true);
  });
});

describe("UiPreferencesProvider", () => {
  it("paints from the localStorage cache before the server responds", async () => {
    localStorage.setItem(
      "uiPreferences",
      JSON.stringify({ ...defaultUiPreferences(), preset: "advanced" }),
    );
    let resolveRemote: (value: unknown) => void = () => {};
    api.getUiPreferences.mockReturnValue(
      new Promise((resolve) => {
        resolveRemote = resolve;
      }),
    );

    const { result } = renderHook(() => useAreaPreferences("hostList"), {
      wrapper,
    });

    expect(result.current.density).toBe("compact");

    await act(async () => {
      resolveRemote(defaultUiPreferences());
    });
  });

  it("keeps the cached value when the fetch fails but still marks loaded", async () => {
    localStorage.setItem(
      "uiPreferences",
      JSON.stringify({ ...defaultUiPreferences(), preset: "simple" }),
    );
    api.getUiPreferences.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useUiPreferencesContext(), { wrapper });

    await waitFor(() => expect(result.current?.loaded).toBe(true));
    expect(result.current?.preferences.preset).toBe("simple");
  });

  it("writes the cache immediately on update", async () => {
    const { result } = renderHook(() => useUiPreferencesContext(), { wrapper });
    await waitFor(() => expect(result.current?.loaded).toBe(true));

    act(() => result.current?.setPreset("simple"));

    const cached = JSON.parse(localStorage.getItem("uiPreferences") ?? "{}");
    expect(cached.preset).toBe("simple");
  });

  it("does not save to the backend in local storage mode", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useUiPreferencesContext(), { wrapper });
    await vi.waitFor(() => expect(result.current?.loaded).toBe(true));

    act(() => result.current?.setPreset("simple"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(api.saveUiPreferences).not.toHaveBeenCalled();
  });

  it("debounces a cloud save and sends only the changed slice", async () => {
    vi.useFakeTimers();
    api.getUserPreferences.mockResolvedValue({ storageMode: "cloud" });

    const { result } = renderHook(() => useUiPreferencesContext(), { wrapper });
    await vi.waitFor(() => expect(result.current?.loaded).toBe(true));

    act(() => result.current?.setPreset("advanced"));
    act(() => result.current?.setOverride("hostList", "showTags", false));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(api.saveUiPreferences).toHaveBeenCalledTimes(1);
    expect(api.saveUiPreferences).toHaveBeenCalledWith({
      preset: "advanced",
      overrides: { hostList: { showTags: false } },
    });
  });

  it("clears an override by sending null", async () => {
    vi.useFakeTimers();
    api.getUserPreferences.mockResolvedValue({ storageMode: "cloud" });
    api.getUiPreferences.mockResolvedValue({
      ...defaultUiPreferences(),
      overrides: { hostList: { showTags: false } },
    });

    const { result } = renderHook(() => useUiPreferencesContext(), { wrapper });
    await vi.waitFor(() => expect(result.current?.loaded).toBe(true));

    act(() => result.current?.clearArea("hostList"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(api.saveUiPreferences).toHaveBeenCalledWith({
      overrides: { hostList: null },
    });
    expect(result.current?.preferences.overrides).toEqual({});
  });

  it("prunes an area once its last override is cleared", async () => {
    api.getUiPreferences.mockResolvedValue({
      ...defaultUiPreferences(),
      overrides: { hostList: { showTags: false } },
    });

    const { result } = renderHook(() => useUiPreferencesContext(), { wrapper });
    await waitFor(() => expect(result.current?.loaded).toBe(true));

    act(() => result.current?.setOverride("hostList", "showTags", null));

    expect(result.current?.preferences.overrides).toEqual({});
  });
});
