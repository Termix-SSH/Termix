import { afterEach, describe, expect, it } from "vitest";
import { isElectron } from "@/lib/electron";
import { markFrameDesktop } from "@/plugin-frame/frame-desktop";

type TestWindow = Window & { IS_ELECTRON?: boolean; electronAPI?: unknown };

describe("markFrameDesktop", () => {
  afterEach(() => {
    delete (window as TestWindow).IS_ELECTRON;
  });

  it("makes isElectron() true in a frame of the desktop app", () => {
    expect((window as TestWindow).electronAPI).toBeUndefined();
    expect(isElectron()).toBe(false);
    markFrameDesktop(true);
    expect(isElectron()).toBe(true);
  });

  it("follows the shell when it says it is not the desktop app", () => {
    markFrameDesktop(true);
    markFrameDesktop(false);
    expect(isElectron()).toBe(false);
  });

  it("ignores a state update that does not mention the desktop", () => {
    markFrameDesktop(true);
    markFrameDesktop(undefined);
    expect(isElectron()).toBe(true);
  });
});
