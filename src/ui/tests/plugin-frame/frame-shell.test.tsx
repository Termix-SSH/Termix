import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFrameShell } from "@/plugin-frame/frame-shell";
import { setFrameState } from "@/plugin-frame/frame-store";

describe("useShell inside a frame", () => {
  it("reads tabs, splits and the user from the state the shell pushes", () => {
    setFrameState({
      tabs: [
        { id: "a", instanceId: "ia", type: "terminal", label: "one" },
        { id: "b", instanceId: "ib", type: "terminal", label: "two" },
      ],
      tabsReady: true,
      activeTabId: "b",
      splits: [
        {
          id: "s1",
          label: "Split",
          full: false,
          panes: [{ id: "p1", index: 0, tabId: "a", label: "one" }],
        },
      ],
      isMobile: false,
      user: { userId: "1", username: "ann", isAdmin: false },
      permissions: ["x"],
    } as never);
    const show = vi.fn();
    const tabs = { closeTab: vi.fn(), openSingletonTab: vi.fn() };
    const { result } = renderHook(() => useFrameShell(tabs as never, show));
    const shell = result.current;
    expect(shell.tabs.activeId).toBe("b");
    expect(shell.tabs.list.map((tab) => tab.id)).toEqual(["a", "b"]);
    expect(shell.tabs.topLevel.map((tab) => tab.id)).toEqual(["b"]);
    expect(shell.split.summaries[0].panes[0].tabId).toBe("a");
    expect(shell.env.user.username).toBe("ann");
    shell.tabs.setActive("a");
    expect(show).toHaveBeenCalledWith("a");
    act(() => {
      setFrameState({ activeTabId: "a" } as never);
    });
    expect(result.current.tabs.activeId).toBe("a");
  });

  it("has nothing that changes the shell for other plugins", () => {
    const { result } = renderHook(() =>
      useFrameShell(
        { closeTab: vi.fn(), openSingletonTab: vi.fn() } as never,
        vi.fn(),
      ),
    );
    const shell = result.current as unknown as Record<string, unknown>;
    expect(shell.regions).toBeUndefined();
    expect(shell.actions).toBeUndefined();
    expect(shell.registries).toBeUndefined();
    // Present but does nothing.
    (shell.logout as () => void)();
  });
});
