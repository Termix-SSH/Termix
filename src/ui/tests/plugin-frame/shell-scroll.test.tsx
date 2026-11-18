import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  resetShellScroll,
  setShellScrollEmitter,
  setShellViewport,
  useFrameShellScroll,
} from "@/plugin-frame/shell-scroll";

afterEach(() => {
  resetShellScroll();
  document.documentElement.style.removeProperty("--shell-viewport-height");
});

describe("frame shell scroll", () => {
  it("asks while any caller wants it and stops with the last", () => {
    const emit = vi.fn();
    setShellScrollEmitter(emit);
    const one = renderHook(({ on }) => useFrameShellScroll(on), {
      initialProps: { on: true },
    });
    const two = renderHook(() => useFrameShellScroll(true));
    expect(emit.mock.calls).toEqual([[true]]);
    expect(document.documentElement.dataset.shellScroll).toBe("");
    one.rerender({ on: false });
    expect(emit.mock.calls).toEqual([[true]]);
    two.unmount();
    expect(emit.mock.calls).toEqual([[true], [false]]);
    expect(document.documentElement.dataset.shellScroll).toBeUndefined();
  });

  it("tells a shell that connects late", () => {
    renderHook(() => useFrameShellScroll(true));
    const emit = vi.fn();
    setShellScrollEmitter(emit);
    expect(emit).toHaveBeenCalledWith(true);
  });

  it("takes the shell's box height and ignores junk", () => {
    setShellViewport({ height: 640 });
    const read = () =>
      document.documentElement.style.getPropertyValue(
        "--shell-viewport-height",
      );
    expect(read()).toBe("640px");
    setShellViewport({ height: "tall" });
    setShellViewport(null);
    expect(read()).toBe("640px");
  });
});
