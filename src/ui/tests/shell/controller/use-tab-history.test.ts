import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabHistory, useTabHistory } from "@/shell/controller/use-tab-history";

describe("TabHistory", () => {
  it("steps back and forward, skipping closed tabs", () => {
    const history = new TabHistory();
    for (const id of ["a", "b", "c", "d"]) history.record(id);
    const open = new Set(["a", "b", "d"]);
    const isOpen = (id: string) => open.has(id);

    expect(history.stepTo(2, isOpen)).toBe("b");
    expect(history.stepTo(0, isOpen)).toBe("a");
    expect(history.stepTo(1, isOpen)).toBe("b");
    expect(history.stepTo(2, isOpen)).toBe("d");
  });

  it("drops forward entries when a new tab is opened after going back", () => {
    const history = new TabHistory();
    for (const id of ["a", "b", "c"]) history.record(id);
    history.stepTo(0, () => true);
    history.record("x");
    expect(history.entries).toEqual(["a", "x"]);
  });

  it("picks the most recent open tab after a close", () => {
    const history = new TabHistory();
    for (const id of ["a", "b", "c"]) history.record(id);
    expect(history.recent("c", (id) => id !== "b")).toBe("a");
  });
});

describe("useTabHistory", () => {
  it("adds a browser history entry per tab and follows popstate", () => {
    const open = new Set(["dashboard", "t1"]);
    let active = "dashboard";
    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useTabHistory({
          activeTabId: id,
          isOpen: (tab) => open.has(tab),
          isTopLevel: () => true,
          setActiveTabId: (tab) => {
            active = tab;
          },
        }),
      { initialProps: { id: "dashboard" } },
    );
    const start = window.history.length;
    rerender({ id: "t1" });
    expect(window.history.length).toBe(start + 1);
    expect(window.history.state.termixTab).toBe(1);

    act(() => {
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: { termixTab: 0 } }),
      );
    });
    expect(active).toBe("dashboard");
  });
});
