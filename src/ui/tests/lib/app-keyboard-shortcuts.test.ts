import { describe, expect, it, vi } from "vitest";
import {
  dispatchCtrlW,
  createCommandPaletteShortcutMatcher,
  getAltDigitShortcut,
  isShiftKey,
} from "../../lib/app-keyboard-shortcuts";

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

  it("recognizes Alt+digit shortcuts by their logical key", () => {
    expect(getAltDigitShortcut({ key: "7", code: "Digit7" })).toBe(7);
  });

  it("does not swallow layout characters produced by Alt+digit", () => {
    expect(getAltDigitShortcut({ key: "|", code: "Digit7" })).toBeNull();
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

describe("command palette shortcut matching", () => {
  const shift = () =>
    new KeyboardEvent("keydown", {
      key: "Shift",
      code: "ShiftLeft",
      shiftKey: true,
    });
  it("requires a fresh pair after each double Shift", () => {
    const { matches } = createCommandPaletteShortcutMatcher();
    expect(matches(shift(), 1000)).toBe(false);
    expect(matches(shift(), 1100)).toBe(true);
    expect(matches(shift(), 1200)).toBe(false);
    expect(matches(shift(), 1300)).toBe(true);
  });
  it("does not combine slow presses", () => {
    const { matches } = createCommandPaletteShortcutMatcher();
    expect(matches(shift(), 1000)).toBe(false);
    expect(matches(shift(), 1300)).toBe(false);
    expect(matches(shift(), 1400)).toBe(true);
  });
  it.each([
    { key: "A", code: "KeyA", shiftKey: true },
    { key: "Shift", code: "ShiftLeft", ctrlKey: true },
    { key: "Shift", code: "ShiftLeft", metaKey: true },
    { key: "Shift", code: "ShiftLeft", altKey: true },
    { key: "Shift", code: "ShiftLeft", isComposing: true },
    { key: "Process", keyCode: 229 },
    { key: "Shift", code: "ShiftLeft", repeat: true },
  ])("breaks the sequence on %j", (init) => {
    const { matches } = createCommandPaletteShortcutMatcher();
    matches(shift(), 1000);
    expect(matches(new KeyboardEvent("keydown", init), 1050)).toBe(false);
    expect(matches(shift(), 1100)).toBe(false);
  });
  it("resets on lost focus or composition start", () => {
    const { matches, reset } = createCommandPaletteShortcutMatcher();
    matches(shift(), 1000);
    reset();
    expect(matches(shift(), 1100)).toBe(false);
  });
  it("respects consumed key events", () => {
    const { matches } = createCommandPaletteShortcutMatcher();
    matches(shift(), 1000);
    const event = new KeyboardEvent("keydown", {
      key: "Shift",
      cancelable: true,
    });
    event.preventDefault();
    expect(matches(event, 1050)).toBe(false);
    expect(matches(shift(), 1100)).toBe(false);
  });
  it.each([{ ctrlKey: true }, { metaKey: true }])(
    "keeps the explicit shortcut: %j",
    (modifier) => {
      const { matches } = createCommandPaletteShortcutMatcher();
      expect(
        matches(new KeyboardEvent("keydown", { code: "KeyK", ...modifier })),
      ).toBe(true);
      expect(
        matches(
          new KeyboardEvent("keydown", {
            code: "KeyK",
            ...modifier,
            isComposing: true,
          }),
        ),
      ).toBe(false);
    },
  );
});
