import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isCloseActiveTabInput } =
  require("../../../../electron/keyboard-shortcuts.cjs") as {
    isCloseActiveTabInput: (
      input: Record<string, unknown>,
      platform?: string,
    ) => boolean;
  };

const ctrlW = { type: "keyDown", control: true, key: "w" };

describe("Ctrl+W in the desktop app", () => {
  it.each(["win32", "linux"])("closes the active tab on %s", (platform) => {
    expect(isCloseActiveTabInput(ctrlW, platform)).toBe(true);
    expect(isCloseActiveTabInput({ ...ctrlW, key: "W" }, platform)).toBe(true);
  });

  it("leaves macOS to its Cmd+W menu item", () => {
    expect(isCloseActiveTabInput(ctrlW, "darwin")).toBe(false);
  });

  it("ignores other combinations and key releases", () => {
    expect(isCloseActiveTabInput({ ...ctrlW, shift: true }, "linux")).toBe(
      false,
    );
    expect(isCloseActiveTabInput({ ...ctrlW, alt: true }, "linux")).toBe(false);
    expect(isCloseActiveTabInput({ ...ctrlW, type: "keyUp" }, "linux")).toBe(
      false,
    );
    expect(isCloseActiveTabInput({ ...ctrlW, key: "q" }, "linux")).toBe(false);
  });
});
