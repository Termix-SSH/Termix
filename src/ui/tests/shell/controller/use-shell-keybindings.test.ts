import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

vi.mock("@/main-axios", () => ({
  getUserPreferences: vi.fn(async () => ({})),
}));

import { useShellKeybindings } from "@/shell/controller/use-shell-keybindings";

afterEach(cleanup);

function regions(railClick: (view: string) => void, view: string) {
  return {
    left: { view, open: true, setOpen: vi.fn() },
    previousView: () => "history",
    railClick,
  };
}

describe("useShellKeybindings", () => {
  it("Ctrl+Shift+E uses the regions of the latest render", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const tabsState = {
      tabsRef: { current: [] },
      activeTabIdRef: { current: "dashboard" },
      setActiveTabId: vi.fn(),
      closeActiveTabRef: { current: () => {} },
    };
    const props = (railClick: (view: string) => void) =>
      ({
        tabsState,
        regions: regions(railClick, "hosts"),
        palette: { setOpen: vi.fn() },
        splitActionsRef: { current: null },
        toggleFullscreen: () => {},
      }) as never;
    const { rerender } = renderHook((p) => useShellKeybindings(p), {
      initialProps: props(first),
    });
    rerender(props(latest));
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyE",
        ctrlKey: true,
        shiftKey: true,
      }),
    );
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith("history");
  });
});
