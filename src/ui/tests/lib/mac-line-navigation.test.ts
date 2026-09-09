import { describe, expect, it, vi } from "vitest";
import { getMacLineNavigationSequence } from "../../lib/mac-line-navigation";

function keyEvent(
  init: Partial<KeyboardEvent> & Pick<KeyboardEvent, "code">,
): KeyboardEvent {
  return {
    type: "keydown",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent;
}

describe("getMacLineNavigationSequence", () => {
  it("maps Cmd+arrow keys on macOS", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(
      getMacLineNavigationSequence(
        keyEvent({ code: "ArrowLeft", metaKey: true }),
      ),
    ).toBe("\x01");
    expect(
      getMacLineNavigationSequence(
        keyEvent({ code: "ArrowRight", metaKey: true }),
      ),
    ).toBe("\x05");
    vi.unstubAllGlobals();
  });

  it("ignores modified and non-mac shortcuts", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(
      getMacLineNavigationSequence(
        keyEvent({ code: "ArrowLeft", metaKey: true, shiftKey: true }),
      ),
    ).toBeNull();
    vi.unstubAllGlobals();

    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(
      getMacLineNavigationSequence(
        keyEvent({ code: "ArrowLeft", metaKey: true }),
      ),
    ).toBeNull();
    vi.unstubAllGlobals();
  });
});
