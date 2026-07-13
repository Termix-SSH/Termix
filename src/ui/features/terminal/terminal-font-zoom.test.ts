import { describe, expect, it } from "vitest";
import {
  clampTerminalFontSize,
  getTerminalFontZoomDirection,
} from "./terminal-font-zoom";

function keyboardEvent(key: string, overrides: Partial<KeyboardEvent> = {}) {
  return new KeyboardEvent("keydown", {
    key,
    code: key === "+" ? "Equal" : key === "-" ? "Minus" : "KeyA",
    ctrlKey: true,
    ...overrides,
  });
}

describe("terminal font zoom", () => {
  it("recognizes Ctrl/Cmd plus and minus shortcuts", () => {
    expect(getTerminalFontZoomDirection(keyboardEvent("+"))).toBe(1);
    expect(getTerminalFontZoomDirection(keyboardEvent("-"))).toBe(-1);
    expect(
      getTerminalFontZoomDirection(
        keyboardEvent("+", { ctrlKey: false, metaKey: true }),
      ),
    ).toBe(1);
  });

  it("ignores unmodified and Alt-modified keys", () => {
    expect(
      getTerminalFontZoomDirection(keyboardEvent("+", { ctrlKey: false })),
    ).toBeNull();
    expect(
      getTerminalFontZoomDirection(keyboardEvent("+", { altKey: true })),
    ).toBeNull();
  });

  it("keeps the font size within terminal limits", () => {
    expect(clampTerminalFontSize(14, 1)).toBe(15);
    expect(clampTerminalFontSize(36, 1)).toBe(36);
    expect(clampTerminalFontSize(8, -1)).toBe(8);
  });
});
