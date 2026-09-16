import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePaneWidth } from "@/features/file-manager/hooks/usePaneWidth";

const KEY = "test:pane-width";

function mouse(type: string, clientX: number) {
  document.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true }));
}

const opts = { storageKey: KEY, defaultWidth: 224, minWidth: 160 };

describe("usePaneWidth", () => {
  beforeEach(() => localStorage.clear());

  it("starts at the default and restores a stored width", () => {
    expect(renderHook(() => usePaneWidth(opts)).result.current.width).toBe(224);
    localStorage.setItem(KEY, "300");
    expect(renderHook(() => usePaneWidth(opts)).result.current.width).toBe(300);
    localStorage.setItem(KEY, "10"); // below min → ignored
    expect(renderHook(() => usePaneWidth(opts)).result.current.width).toBe(224);
  });

  it("follows the drag, clamps to the minimum, and persists on release", () => {
    const { result } = renderHook(() => usePaneWidth(opts));
    act(() => {
      result.current.startResize({
        clientX: 400,
        preventDefault() {},
        stopPropagation() {},
      } as unknown as React.MouseEvent);
    });
    expect(result.current.isResizing).toBe(true);
    act(() => mouse("mousemove", 460));
    expect(result.current.width).toBe(284);
    act(() => mouse("mousemove", 100));
    expect(result.current.width).toBe(160);
    act(() => mouse("mouseup", 100));
    expect(result.current.isResizing).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("160");
  });

  it("resets to the default", () => {
    localStorage.setItem(KEY, "300");
    const { result } = renderHook(() => usePaneWidth(opts));
    act(() => result.current.resetWidth());
    expect(result.current.width).toBe(224);
    expect(localStorage.getItem(KEY)).toBe("224");
  });
});
