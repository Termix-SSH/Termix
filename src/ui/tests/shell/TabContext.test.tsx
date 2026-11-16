import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  clearTermixSessionStorage,
  TabProvider,
  useTabs,
  useTabsSafe,
} from "@/shell/TabContext";
import { registerTabType, resetTabTypes } from "@/shell/tab-registry";

const wrapper = ({ children }: { children: ReactNode }) => (
  <TabProvider>{children}</TabProvider>
);
const Empty = () => null;

afterEach(() => resetTabTypes());

function setup() {
  registerTabType({ id: "terminal", component: Empty, commandTarget: true });
  registerTabType({
    id: "settings",
    component: Empty,
    singleton: true,
    titleKey: "nav.settings",
  });
  registerTabType({ id: "files", component: Empty });
  return renderHook(() => useTabs(), { wrapper });
}

const host = (id: number) => ({
  id,
  username: "root",
  ip: `10.0.0.${id}`,
  port: 22,
});

describe("TabProvider", () => {
  it("starts with the home tab", () => {
    const { result } = setup();
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].type).toBe("home");
    expect(result.current.currentTab).toBe(1);
  });

  it("numbers terminal tabs with the same title", () => {
    const { result } = setup();
    act(
      () =>
        void result.current.addTab({ type: "terminal", title: "web" } as never),
    );
    act(
      () =>
        void result.current.addTab({ type: "terminal", title: "web" } as never),
    );
    act(
      () =>
        void result.current.addTab({
          type: "terminal",
          title: "web (2)",
        } as never),
    );
    expect(result.current.tabs.map((t) => t.title)).toEqual([
      expect.any(String),
      "web",
      "web (2)",
      "web (3)",
    ]);
    expect(result.current.tabs[1].terminalRef).toBeDefined();
  });

  it("focuses an open singleton tab instead of opening another", () => {
    const { result } = setup();
    let first = 0;
    act(() => {
      first = result.current.addTab({ type: "settings" } as never);
    });
    act(
      () => void result.current.addTab({ type: "files", title: "f" } as never),
    );
    let again = 0;
    act(() => {
      again = result.current.addTab({ type: "settings" } as never);
    });
    expect(again).toBe(first);
    expect(result.current.currentTab).toBe(first);
    expect(
      result.current.tabs.filter((t) => t.type === "settings"),
    ).toHaveLength(1);
  });

  it("moves to the next tab on close and back to home when all are closed", () => {
    const { result } = setup();
    let a = 0;
    let b = 0;
    act(() => {
      a = result.current.addTab({ type: "files", title: "a" } as never);
    });
    act(() => {
      b = result.current.addTab({ type: "files", title: "b" } as never);
    });
    act(() => result.current.setCurrentTab(a));
    act(() => result.current.removeTab(a));
    expect(result.current.currentTab).toBe(b);
    act(() => result.current.removeTab(b));
    act(() => result.current.removeTab(1));
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].type).toBe("home");
    expect(result.current.currentTab).toBe(1);
  });

  it("toggles split tabs and allows at most six", () => {
    const { result } = setup();
    for (let i = 2; i <= 8; i++) act(() => result.current.setSplitScreenTab(i));
    expect(result.current.allSplitScreenTab).toEqual([2, 3, 4, 5, 6, 7]);
    act(() => result.current.setSplitScreenTab(3));
    expect(result.current.allSplitScreenTab).toEqual([2, 4, 5, 6, 7]);
  });

  it("reorders, updates and renames tabs for a changed host", () => {
    const { result } = setup();
    let id = 0;
    act(() => {
      id = result.current.addTab({
        type: "files",
        title: "x",
        hostConfig: host(5),
      } as never);
    });
    act(() => result.current.reorderTabs(1, 0));
    expect(result.current.tabs[0].id).toBe(id);
    act(() => result.current.updateTab(id, { title: "renamed" }));
    expect(result.current.getTab(id)?.title).toBe("renamed");
    act(() =>
      result.current.updateHostConfig(5, { ...host(5), name: "Web server" }),
    );
    expect(result.current.getTab(id)?.title).toBe("Web server");
    expect(result.current.getTab(id)?.hostConfig?.instanceId).toBeTruthy();
    act(() => result.current.updateHostConfig(5, { ...host(5), name: "" }));
    expect(result.current.getTab(id)?.title).not.toBe("Web server");
  });
});

describe("outside the provider", () => {
  it("useTabs throws and useTabsSafe gives a no-op set", () => {
    expect(() => renderHook(() => useTabs())).toThrow("TabProvider");
    const { result } = renderHook(() => useTabsSafe());
    expect(result.current.tabs).toEqual([]);
    expect(result.current.addTab({} as never)).toBe(-1);
    result.current.removeTab(1);
    result.current.setCurrentTab(1);
    result.current.setSplitScreenTab(1);
    result.current.reorderTabs(0, 1);
    result.current.updateHostConfig(1, host(1));
    result.current.updateTab(1, {});
    expect(result.current.getTab(1)).toBeUndefined();
  });

  it("clears the saved tab keys", () => {
    localStorage.setItem("termix_tabs", "x");
    localStorage.setItem("termix_currentTab", "1");
    clearTermixSessionStorage();
    expect(localStorage.getItem("termix_tabs")).toBeNull();
    expect(localStorage.getItem("termix_currentTab")).toBeNull();
  });
});
