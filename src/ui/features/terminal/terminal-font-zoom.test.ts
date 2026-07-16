import { describe, expect, it } from "vitest";
import {
  getNextTerminalFontSize,
  getTerminalFontZoomDirection,
} from "./terminal-font-zoom";

function keyEvent(
  overrides: Partial<KeyboardEvent>,
): Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey"> {
  return {
    altKey: false,
    code: "",
    ctrlKey: false,
    key: "",
    metaKey: false,
    ...overrides,
  };
}

describe("getTerminalFontZoomDirection", () => {
  it("recognizes Ctrl+Plus and Ctrl+Minus", () => {
    expect(
      getTerminalFontZoomDirection(
        keyEvent({ ctrlKey: true, code: "Equal", key: "+" }),
      ),
    ).toBe(1);
    expect(
      getTerminalFontZoomDirection(
        keyEvent({ ctrlKey: true, code: "Minus", key: "-" }),
      ),
    ).toBe(-1);
  });

  it("recognizes unshifted equal, numpad, and macOS shortcuts", () => {
    expect(
      getTerminalFontZoomDirection(
        keyEvent({ ctrlKey: true, code: "Equal", key: "=" }),
      ),
    ).toBe(1);
    expect(
      getTerminalFontZoomDirection(
        keyEvent({ ctrlKey: true, code: "NumpadAdd", key: "+" }),
      ),
    ).toBe(1);
    expect(
      getTerminalFontZoomDirection(
        keyEvent({ metaKey: true, code: "NumpadSubtract", key: "-" }),
      ),
    ).toBe(-1);
  });

  it("ignores unmodified and Alt-modified keys", () => {
    expect(
      getTerminalFontZoomDirection(keyEvent({ code: "Equal", key: "+" })),
    ).toBe(0);
    expect(
      getTerminalFontZoomDirection(
        keyEvent({ altKey: true, ctrlKey: true, code: "Minus", key: "-" }),
      ),
    ).toBe(0);
  });
});

describe("getNextTerminalFontSize", () => {
  it("changes the font size one pixel at a time", () => {
    expect(getNextTerminalFontSize(14, 1)).toBe(15);
    expect(getNextTerminalFontSize(14, -1)).toBe(13);
  });

  it("keeps the existing zoom limits", () => {
    expect(getNextTerminalFontSize(36, 1)).toBe(36);
    expect(getNextTerminalFontSize(8, -1)).toBe(8);
  });
});
