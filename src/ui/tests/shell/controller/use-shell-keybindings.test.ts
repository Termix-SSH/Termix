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

  describe("Ctrl+W in the desktop app", () => {
    function setupCloseTab(platform = "Win32") {
      (window as unknown as { IS_ELECTRON?: boolean }).IS_ELECTRON = true;
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const closeActiveTab = vi.fn();
      renderHook(() =>
        useShellKeybindings({
          tabsState: {
            tabsRef: { current: [] },
            activeTabIdRef: { current: "dashboard" },
            setActiveTabId: vi.fn(),
            closeActiveTabRef: { current: closeActiveTab },
          },
          regions: regions(vi.fn(), "hosts"),
          palette: { setOpen: vi.fn() },
          splitActionsRef: { current: null },
          toggleFullscreen: () => {},
        } as never),
      );
      return closeActiveTab;
    }

    const ctrlW = () =>
      new KeyboardEvent("keydown", {
        key: "w",
        code: "KeyW",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });

    afterEach(() => {
      delete (window as unknown as { IS_ELECTRON?: boolean }).IS_ELECTRON;
      vi.restoreAllMocks();
    });

    it("closes the active tab", () => {
      const closeActiveTab = setupCloseTab();
      const event = ctrlW();
      document.body.dispatchEvent(event);
      expect(closeActiveTab).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it("leaves it to what has focus when that used it, like a terminal", () => {
      const closeActiveTab = setupCloseTab();
      const terminal = document.createElement("textarea");
      document.body.appendChild(terminal);
      terminal.addEventListener("keydown", (event) => event.preventDefault());
      terminal.dispatchEvent(ctrlW());
      terminal.remove();
      expect(closeActiveTab).not.toHaveBeenCalled();
    });

    it("leaves macOS to its Cmd+W menu item", () => {
      const closeActiveTab = setupCloseTab("MacIntel");
      const event = ctrlW();
      document.body.dispatchEvent(event);
      expect(closeActiveTab).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });
});
