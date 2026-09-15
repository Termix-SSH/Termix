import { describe, expect, it, vi } from "vitest";
import { dispatchCtrlW, isShiftKey } from "../../lib/app-keyboard-shortcuts";

describe("app keyboard shortcuts", () => {
  it.each(["ShiftLeft", "ShiftRight"])(
    "accepts %s for double Shift",
    (code) => {
      expect(isShiftKey({ key: "Shift", code })).toBe(true);
    },
  );

  it("does not classify other keys as Shift", () => {
    expect(isShiftKey({ key: "w", code: "KeyW" })).toBe(false);
  });

  it("lets the focused control consume Electron Ctrl+W", () => {
    const target = document.createElement("input");
    const listener = vi.fn((event: KeyboardEvent) => event.preventDefault());
    target.addEventListener("keydown", listener);

    expect(dispatchCtrlW(target)).toBe(true);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ key: "w", code: "KeyW", ctrlKey: true }),
    );
  });

  it("falls back to closing the active tab when Ctrl+W is not consumed", () => {
    expect(dispatchCtrlW(document.createElement("div"))).toBe(false);
  });
});
