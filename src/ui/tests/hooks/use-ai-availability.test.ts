import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const getAiStatus = vi.fn();
vi.mock("@/api/ai-api", () => ({ getAiStatus }));

const { useAiAvailability, notifyAiStatusChanged } =
  await import("../../hooks/use-ai-availability.js");

beforeEach(() => {
  getAiStatus.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAiAvailability", () => {
  it("starts hidden and unloaded before the status answers", () => {
    getAiStatus.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAiAvailability());
    expect(result.current).toEqual({
      globallyEnabled: false,
      userEnabled: false,
      loaded: false,
    });
  });

  it("reports both gates open when the admin and the user enabled it", async () => {
    getAiStatus.mockResolvedValue({
      globallyEnabled: true,
      enabled: true,
      allowReadOnlyCommands: false,
    });
    const { result } = renderHook(() => useAiAvailability());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.globallyEnabled).toBe(true);
    expect(result.current.userEnabled).toBe(true);
  });

  it("keeps userEnabled false when the user has not opted in", async () => {
    getAiStatus.mockResolvedValue({
      globallyEnabled: true,
      enabled: false,
      allowReadOnlyCommands: false,
    });
    const { result } = renderHook(() => useAiAvailability());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.globallyEnabled).toBe(true);
    expect(result.current.userEnabled).toBe(false);
  });

  it("the admin kill switch wins over the user opt-in", async () => {
    getAiStatus.mockResolvedValue({
      globallyEnabled: false,
      enabled: true,
      allowReadOnlyCommands: true,
    });
    const { result } = renderHook(() => useAiAvailability());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.globallyEnabled).toBe(false);
    expect(result.current.userEnabled).toBe(false);
  });

  it("treats a failed status call as off", async () => {
    getAiStatus.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useAiAvailability());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.globallyEnabled).toBe(false);
    expect(result.current.userEnabled).toBe(false);
  });

  it("re-reads the status when notified", async () => {
    getAiStatus.mockResolvedValue({
      globallyEnabled: true,
      enabled: true,
      allowReadOnlyCommands: false,
    });
    const { result } = renderHook(() => useAiAvailability());
    await waitFor(() => expect(result.current.globallyEnabled).toBe(true));

    getAiStatus.mockResolvedValue({
      globallyEnabled: false,
      enabled: true,
      allowReadOnlyCommands: false,
    });
    act(() => notifyAiStatusChanged());
    await waitFor(() => expect(result.current.globallyEnabled).toBe(false));
    expect(result.current.userEnabled).toBe(false);
  });

  it("also re-reads on the older hiddenRailTabsChanged event", async () => {
    getAiStatus.mockResolvedValue({
      globallyEnabled: true,
      enabled: false,
      allowReadOnlyCommands: false,
    });
    const { result } = renderHook(() => useAiAvailability());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    getAiStatus.mockResolvedValue({
      globallyEnabled: true,
      enabled: true,
      allowReadOnlyCommands: false,
    });
    act(() => window.dispatchEvent(new Event("hiddenRailTabsChanged")));
    await waitFor(() => expect(result.current.userEnabled).toBe(true));
  });
});
