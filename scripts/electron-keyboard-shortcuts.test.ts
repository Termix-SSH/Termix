import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isCloseActiveTabInput } =
  require("../electron/keyboard-shortcuts.cjs") as {
    isCloseActiveTabInput: (input: {
      type: string;
      key: string;
      control?: boolean;
      alt?: boolean;
      shift?: boolean;
      meta?: boolean;
    }) => boolean;
  };

describe("Electron keyboard shortcuts", () => {
  it("recognizes Ctrl+W without extra modifiers", () => {
    expect(
      isCloseActiveTabInput({ type: "keyDown", key: "w", control: true }),
    ).toBe(true);
  });

  it.each([
    { type: "keyUp", key: "w", control: true },
    { type: "keyDown", key: "w", control: true, alt: true },
    { type: "keyDown", key: "w", control: true, shift: true },
    { type: "keyDown", key: "w", meta: true },
    { type: "keyDown", key: "q", control: true },
  ])("does not consume other input: %o", (input) => {
    expect(isCloseActiveTabInput(input)).toBe(false);
  });
});
