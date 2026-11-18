import { afterEach, describe, expect, it, vi } from "vitest";
import {
  reportFrameCover,
  resetFrameCover,
  setFrameCoverEmitter,
} from "@/plugin-frame/frame-cover";

afterEach(() => resetFrameCover());

describe("frame cover", () => {
  it("tells the shell once per change and marks the page", () => {
    const emit = vi.fn();
    setFrameCoverEmitter(emit);
    reportFrameCover(true);
    reportFrameCover(true);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenLastCalledWith(true);
    expect(document.documentElement.dataset.frameCover).toBe("");
    reportFrameCover("wide");
    expect(emit).toHaveBeenLastCalledWith("wide");
    reportFrameCover(false);
    expect(emit).toHaveBeenLastCalledWith(false);
    expect(document.documentElement.dataset.frameCover).toBeUndefined();
  });

  it("sends a cover asked for before the shell connected", () => {
    reportFrameCover(true);
    const emit = vi.fn();
    setFrameCoverEmitter(emit);
    expect(emit).toHaveBeenCalledWith(true);
  });
});
