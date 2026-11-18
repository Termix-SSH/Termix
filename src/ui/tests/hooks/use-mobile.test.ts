import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useIsMobile } from "../../hooks/use-mobile.js";

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: width < 768,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { electronAPI?: unknown }).electronAPI;
});

describe("useIsMobile", () => {
  it("is true below the 768px breakpoint", () => {
    setViewport(500);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("is false at or above the breakpoint", () => {
    setViewport(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("treats exactly 768 as not mobile", () => {
    setViewport(768);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("keeps the desktop layout in the desktop app, however narrow", () => {
    setViewport(500);
    (window as { electronAPI?: unknown }).electronAPI = { isElectron: true };
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
});

describe("useIsMobile in a plugin frame", () => {
  it("follows the shell, not the frame's own width", async () => {
    const { setForeignRuntime } =
      await import("@/components/foreign/foreign-runtime");
    const { setFrameState, resetFrameState } =
      await import("@/plugin-frame/frame-store");
    setViewport(400);
    setForeignRuntime({} as never);
    setFrameState({ isMobile: false });
    const { result, rerender } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    setFrameState({ isMobile: true });
    rerender();
    expect(result.current).toBe(true);
    setForeignRuntime(null);
    resetFrameState();
  });
});
