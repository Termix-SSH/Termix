import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPaneNavDirection,
  paneNavHotkeyLabel,
} from "../../lib/pane-nav-hotkey";

function keyEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    code: "ArrowLeft",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent;
}

afterEach(() => vi.unstubAllGlobals());

describe("pane-nav-hotkey", () => {
  it("uses Alt+Arrow outside macOS", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(getPaneNavDirection(keyEvent({ altKey: true }))).toBe("left");
    expect(
      getPaneNavDirection(keyEvent({ code: "ArrowDown", altKey: true })),
    ).toBe("down");
    expect(
      getPaneNavDirection(keyEvent({ altKey: true, metaKey: true })),
    ).toBeNull();
    expect(paneNavHotkeyLabel()).toBe("Alt+Arrows");
  });

  it("leaves Option+Arrow to the shell on macOS", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(getPaneNavDirection(keyEvent({ altKey: true }))).toBeNull();
    expect(
      getPaneNavDirection(
        keyEvent({ code: "ArrowRight", altKey: true, metaKey: true }),
      ),
    ).toBe("right");
    expect(paneNavHotkeyLabel()).toBe("Cmd+Option+Arrows");
  });

  it("ignores other keys and modifiers", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(
      getPaneNavDirection(keyEvent({ code: "KeyA", altKey: true })),
    ).toBeNull();
    expect(
      getPaneNavDirection(keyEvent({ altKey: true, shiftKey: true })),
    ).toBeNull();
    expect(getPaneNavDirection(keyEvent({}))).toBeNull();
  });
});
