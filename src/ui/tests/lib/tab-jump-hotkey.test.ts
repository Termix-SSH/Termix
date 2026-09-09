import { describe, expect, it, vi } from "vitest";
import {
  getTabJumpDigit,
  isMacPlatform,
  isTabJumpHotkey,
  tabJumpHotkeyKeys,
} from "../../lib/tab-jump-hotkey";

function keyEvent(
  init: Partial<KeyboardEvent> & Pick<KeyboardEvent, "code">,
): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent;
}

describe("tab-jump-hotkey", () => {
  it("detects macOS platform", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(isMacPlatform()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("uses Cmd+1-9 on macOS", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(
      isTabJumpHotkey(
        keyEvent({ code: "Digit3", metaKey: true, altKey: false }),
      ),
    ).toBe(true);
    expect(
      isTabJumpHotkey(
        keyEvent({ code: "Digit3", altKey: true, metaKey: false }),
      ),
    ).toBe(false);
    expect(getTabJumpDigit(keyEvent({ code: "Digit3", metaKey: true }))).toBe(
      3,
    );
    expect(tabJumpHotkeyKeys()).toEqual(["Cmd", "1-9"]);
    vi.unstubAllGlobals();
  });

  it("uses Alt+1-9 on non-macOS", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(
      isTabJumpHotkey(
        keyEvent({ code: "Digit3", altKey: true, metaKey: false }),
      ),
    ).toBe(true);
    expect(
      isTabJumpHotkey(
        keyEvent({ code: "Digit3", metaKey: true, altKey: false }),
      ),
    ).toBe(false);
    expect(getTabJumpDigit(keyEvent({ code: "Digit3", altKey: true }))).toBe(
      3,
    );
    expect(tabJumpHotkeyKeys()).toEqual(["Alt", "1-9"]);
    vi.unstubAllGlobals();
  });
});
