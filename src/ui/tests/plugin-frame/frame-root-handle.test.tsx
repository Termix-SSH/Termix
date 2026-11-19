import { forwardRef, useImperativeHandle, type Ref } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { FrameRoot, setFrameProps } from "@/plugin-frame/frame-root";

const Tab = forwardRef(function Tab(
  { handleRef }: { handleRef?: Ref<unknown> },
  _ref,
) {
  useImperativeHandle(handleRef, () => ({ focus: () => "focused" }), []);
  return <div>tab</div>;
});

afterEach(() => {
  cleanup();
  act(() => setFrameProps({}));
});

describe("a framed view's handle", () => {
  it("goes to the shell through __setHandle and clears on unmount", () => {
    const setHandle = vi.fn();
    act(() => setFrameProps({ __setHandle: setHandle }));
    const { unmount } = render(<FrameRoot fit="fill" component={Tab} />);
    const handle = setHandle.mock.calls.at(-1)?.[0] as { focus: () => string };
    expect(handle.focus()).toBe("focused");
    unmount();
    expect(setHandle.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it("keeps calling the newest setter after the props change", () => {
    const first = vi.fn();
    const second = vi.fn();
    act(() => setFrameProps({ __setHandle: first }));
    const { unmount } = render(<FrameRoot fit="fill" component={Tab} />);
    act(() => setFrameProps({ __setHandle: second }));
    unmount();
    expect(second).toHaveBeenLastCalledWith(null);
  });

  it("rebuilds a standalone view's query the shell sent as text", () => {
    const seen = vi.fn();
    function View(props: Record<string, unknown>) {
      const params = props.params as URLSearchParams | undefined;
      seen(params?.get("token"), "__params" in props);
      return null;
    }
    act(() => setFrameProps({ __params: "view=shared&token=abc" }));
    render(<FrameRoot fit="fill" component={View} />);
    expect(seen).toHaveBeenLastCalledWith("abc", false);
  });

  it("hands no ref to a view the shell asked no handle from", () => {
    const seen = vi.fn();
    function View(props: Record<string, unknown>) {
      seen("handleRef" in props);
      return null;
    }
    render(<FrameRoot fit="fill" component={View} />);
    expect(seen).toHaveBeenLastCalledWith(false);
  });
});
