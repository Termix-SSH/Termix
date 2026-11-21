import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFrameHandle } from "@/plugin-host/frames/frame-plugins";
import { tabHandleOwner } from "@/plugin-host/frames/tab-handle-owners";

describe("useFrameHandle", () => {
  it("swaps handleRef for a setter that fills it with the frame's handle", () => {
    const handleRef = vi.fn();
    const { result, unmount } = renderHook(() =>
      useFrameHandle("ssh-terminal", { handleRef, host: 3 }),
    );
    expect(result.current.handleRef).toBeUndefined();
    expect(result.current.host).toBe(3);
    const setHandle = result.current.__setHandle as (value: unknown) => void;

    const handle = { focus: vi.fn() };
    setHandle(handle);
    expect(handleRef).toHaveBeenLastCalledWith(handle);
    expect(tabHandleOwner(handle)).toBe("ssh-terminal");

    setHandle("not a handle");
    expect(handleRef).toHaveBeenLastCalledWith(null);

    unmount();
    expect(handleRef).toHaveBeenLastCalledWith(null);
  });

  it("fills an object ref too", () => {
    const handleRef = { current: null as unknown };
    const { result } = renderHook(() =>
      useFrameHandle("ssh-terminal", { handleRef }),
    );
    const handle = { reconnect: vi.fn() };
    (result.current.__setHandle as (value: unknown) => void)(handle);
    expect(handleRef.current).toBe(handle);
  });

  it("passes props through untouched when no handle is wanted", () => {
    const props = { host: 1 };
    const { result } = renderHook(() => useFrameHandle("docker", props));
    expect(result.current).toBe(props);
  });
});
