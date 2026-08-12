import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Tab } from "@/types/ui-types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

import { SplitView, defaultSizes } from "../../shell/SplitView";

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "tab-1",
    instanceId: "instance-1",
    type: "terminal",
    label: "web-01",
    openedAt: 0,
    ...overrides,
  } as Tab;
}

afterEach(() => {
  cleanup();
});

describe("defaultSizes", () => {
  it("returns the expected default split for 2-way", () => {
    expect(defaultSizes("2-way")).toEqual({
      rowSizes: [100],
      rowColSizes: [[50, 50]],
    });
  });

  it("returns a single full pane for 'none'", () => {
    expect(defaultSizes("none")).toEqual({
      rowSizes: [100],
      rowColSizes: [[100]],
    });
  });
});

describe("SplitView - controlled rowSizes/rowColSizes", () => {
  it("renders panes using externally-supplied non-default sizes, not the built-in default", () => {
    const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2", label: "t2" })];

    const { container } = render(
      <SplitView
        tabs={tabs}
        paneTabIds={["t1", "t2", null, null, null, null]}
        splitMode="2-way"
        rowSizes={[100]}
        rowColSizes={[[30, 70]]}
        onRowSizesChange={() => {}}
        onRowColSizesChange={() => {}}
      />,
    );

    // The first pane's flex column width should reflect the supplied 30%,
    // not the 50/50 default - this is the regression guard for the
    // rowSizes/rowColSizes lift-up out of SplitView's old internal state.
    const widthStyled = container.querySelectorAll('[style*="width: 30%"]');
    expect(widthStyled.length).toBeGreaterThan(0);
  });

  it("calls onReset (not an internal reset) when the Reset button is clicked", () => {
    const onReset = vi.fn();
    const tabs = [makeTab({ id: "t1" })];

    render(
      <SplitView
        tabs={tabs}
        paneTabIds={["t1", null, null, null, null, null]}
        splitMode="2-way"
        rowSizes={[100]}
        rowColSizes={[[30, 70]]}
        onRowSizesChange={() => {}}
        onRowColSizesChange={() => {}}
        onReset={onReset}
      />,
    );

    fireEvent.click(screen.getByTitle("Reset to equal split"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("does not mutate rowSizes/rowColSizes props locally - reflects prop changes on rerender", () => {
    const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2", label: "t2" })];

    const { container, rerender } = render(
      <SplitView
        tabs={tabs}
        paneTabIds={["t1", "t2", null, null, null, null]}
        splitMode="2-way"
        rowSizes={[100]}
        rowColSizes={[[50, 50]]}
        onRowSizesChange={() => {}}
        onRowColSizesChange={() => {}}
      />,
    );
    expect(
      container.querySelectorAll('[style*="width: 50%"]').length,
    ).toBeGreaterThan(0);

    rerender(
      <SplitView
        tabs={tabs}
        paneTabIds={["t1", "t2", null, null, null, null]}
        splitMode="2-way"
        rowSizes={[100]}
        rowColSizes={[[20, 80]]}
        onRowSizesChange={() => {}}
        onRowColSizesChange={() => {}}
      />,
    );
    expect(
      container.querySelectorAll('[style*="width: 20%"]').length,
    ).toBeGreaterThan(0);
  });
});
