import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("@/sidebar/rail-items", () => ({
  rightDockableIds: () => ["history", "alerts"],
}));

import { DOCK_DEFAULT_WIDTH, useRegions } from "@/shell/controller/use-regions";

beforeEach(() => localStorage.clear());

describe("useRegions", () => {
  it("toggles the left dock on a second click and switches on another", () => {
    const { result } = renderHook(() => useRegions(false));
    expect(result.current.left).toMatchObject({ view: "hosts", open: true });

    act(() => result.current.railClick("hosts"));
    expect(result.current.left.open).toBe(false);

    act(() => result.current.railClick("credentials"));
    expect(result.current.left).toMatchObject({
      view: "credentials",
      open: true,
    });
    expect(result.current.previousView()).toBe("hosts");
  });

  it("moves a panel between docks instead of copying it", () => {
    const { result } = renderHook(() => useRegions(false));
    act(() => result.current.railClick("history"));
    act(() => result.current.openInRightDock("history"));
    expect(result.current.right.view).toBe("history");
    expect(result.current.left.open).toBe(false);

    act(() => result.current.railClick("history"));
    expect(result.current.right.view).toBeNull();
    expect(result.current.left).toMatchObject({ view: "history", open: true });
  });

  it("brings back the last right dock panel and remembers sizes", () => {
    const { result, unmount } = renderHook(() => useRegions(false));
    act(() => result.current.right.setView("alerts"));
    act(() => result.current.toggleRightDock());
    expect(result.current.right.view).toBeNull();
    act(() => result.current.toggleRightDock());
    expect(result.current.right.view).toBe("alerts");

    act(() => result.current.left.setWidth(400));
    unmount();
    const again = renderHook(() => useRegions(false));
    expect(again.result.current.left.width).toBe(400);
    expect(again.result.current.right.view).toBe("alerts");
    act(() => again.result.current.left.resetWidth());
    expect(again.result.current.left.width).toBe(DOCK_DEFAULT_WIDTH);
  });

  it("closes the sidebar on mobile and restores it after", () => {
    const { result, rerender } = renderHook(
      ({ mobile }) => useRegions(mobile),
      { initialProps: { mobile: false } },
    );
    rerender({ mobile: true });
    expect(result.current.left.open).toBe(false);
    rerender({ mobile: false });
    expect(result.current.left.open).toBe(true);
  });

  it("widens for the widest editing panel or inline view", () => {
    const { result } = renderHook(() => useRegions(false));
    act(() => result.current.panelEditingSetter("hosts")(true));
    expect(result.current.left.editing).toBe(true);
    act(() => result.current.scopeEditingSetter("hosts")("wide"));
    expect(result.current.left.editing).toBe("wide");
    expect(result.current.panelEditingSetter("hosts")).toBe(
      result.current.panelEditingSetter("hosts"),
    );
  });
});
