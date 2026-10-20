import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { trackTabHandle, useTabHandlesVersion } from "@/shell/tab-handles";

afterEach(cleanup);

describe("trackTabHandle", () => {
  it("passes no ref through", () => {
    expect(trackTabHandle(undefined)).toBeUndefined();
  });

  it("returns one callback per ref that fills it and bumps the version", () => {
    const ref = createRef<unknown>();
    const callback = trackTabHandle(ref) as (value: unknown) => void;
    expect(trackTabHandle(ref)).toBe(callback);

    const { result } = renderHook(() => useTabHandlesVersion());
    const before = result.current;
    const handle = { disconnect: () => {} };
    act(() => callback(handle));
    expect(ref.current).toBe(handle);
    expect(result.current).toBe(before + 1);

    act(() => callback(handle));
    expect(result.current).toBe(before + 1);

    act(() => callback(null));
    expect(ref.current).toBeNull();
    expect(result.current).toBe(before + 2);
  });
});
