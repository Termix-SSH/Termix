import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMouseHistoryGuard } from "@/shell/controller/use-mouse-history-guard";

function click(type: string, button: number) {
  const event = new MouseEvent(type, {
    button,
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("mouse history guard", () => {
  it("stops the side buttons from leaving Termix, and nothing else", () => {
    const { unmount } = renderHook(() => useMouseHistoryGuard());
    for (const type of ["mouseup", "auxclick"]) {
      expect(click(type, 3)).toBe(true);
      expect(click(type, 4)).toBe(true);
      expect(click(type, 0)).toBe(false);
      expect(click(type, 1)).toBe(false);
    }
    unmount();
    expect(click("mouseup", 3)).toBe(false);
  });

  it("still lets a view with its own history see the click", () => {
    renderHook(() => useMouseHistoryGuard());
    const seen = vi.fn();
    document.body.addEventListener("mouseup", seen);
    click("mouseup", 3);
    expect(seen).toHaveBeenCalledOnce();
    document.body.removeEventListener("mouseup", seen);
  });
});
