import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Tab } from "@/types/ui-types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

import { SplitView, type SplitViewActions } from "@/shell/split/SplitView";
import { makeSplitTab } from "@/shell/split/split-tabs";
import {
  createPane,
  createSplitNode,
  createSplitState,
  listPanes,
  toggleZoom,
} from "@/shell/split/split-tree";

afterEach(cleanup);

function tab(id: string, label: string): Tab {
  return {
    id,
    instanceId: id,
    type: "terminal",
    label,
    openedAt: 0,
    parentSplitTabId: "split-s",
  } as Tab;
}

function actions(): SplitViewActions {
  return {
    focusPane: vi.fn(),
    resize: vi.fn(),
    equalize: vi.fn(),
    splitPane: vi.fn(),
    closePane: vi.fn(),
    closeSession: vi.fn(),
    moveToTab: vi.fn(),
    showInPane: vi.fn(),
    swapPanes: vi.fn(),
    toggleZoom: vi.fn(),
    resizeEnd: vi.fn(),
  };
}

function setup({
  mobile = false,
  zoom = false,
}: { mobile?: boolean; zoom?: boolean } = {}) {
  const root = createSplitNode("row", [
    createPane("t1"),
    createSplitNode("column", [createPane("t2"), createPane(null)]),
  ]);
  let state = createSplitState(root, listPanes(root)[0].id);
  if (zoom) state = toggleZoom(state, listPanes(root)[1].id);
  const splitTab = makeSplitTab("s", "Split 1", state, 0);
  const tabs = [tab("t1", "web-01"), tab("t2", "db-01"), splitTab];
  const act = actions();
  const onPaneContentRef = vi.fn();
  const renderEmptyPane = vi.fn((paneId: string, index: number) => (
    <div data-testid={`empty-${index}`}>{paneId}</div>
  ));
  const view = render(
    <SplitView
      splitTab={splitTab}
      tabs={tabs}
      isMobile={mobile}
      actions={act}
      onPaneContentRef={onPaneContentRef}
      renderEmptyPane={renderEmptyPane}
    />,
  );
  return {
    ...view,
    act,
    onPaneContentRef,
    panes: listPanes(state.root),
  };
}

describe("SplitView", () => {
  it("renders every pane of the tree with a numbered header", () => {
    const { container, panes } = setup();
    const rendered = Array.from(
      container.querySelectorAll("[data-split-pane-id]"),
    ).map((el) => el.getAttribute("data-split-pane-id"));
    expect(rendered).toEqual(panes.map((pane) => pane.id));
    expect(screen.getByText("web-01")).toBeTruthy();
    expect(screen.getByText("db-01")).toBeTruthy();
  });

  it("hands each filled pane's content element to the shell", () => {
    const { onPaneContentRef, panes } = setup();
    const registered = onPaneContentRef.mock.calls
      .filter(([, el]) => el)
      .map(([paneId]) => paneId);
    expect(registered).toEqual([panes[0].id, panes[1].id]);
  });

  it("shows the picker in an empty pane, with its number", () => {
    const { panes } = setup();
    expect(screen.getByTestId("empty-3").textContent).toBe(panes[2].id);
  });

  it("focuses a pane when it is pressed", () => {
    const { container, act, panes } = setup();
    const pane = container.querySelector(
      `[data-split-pane-id="${panes[1].id}"]`,
    )!;
    fireEvent.pointerDown(pane);
    expect(act.focusPane).toHaveBeenCalledWith(panes[1].id);
  });

  it("focuses a pane from a click inside content the shell moved in", () => {
    const { act, onPaneContentRef, panes } = setup();
    const contentEl = onPaneContentRef.mock.calls.find(
      ([paneId, el]) => paneId === panes[1].id && el,
    )![1] as HTMLDivElement;
    // What the shell does with a tab's portal node.
    const tabNode = document.createElement("div");
    contentEl.appendChild(tabNode);
    fireEvent.pointerDown(tabNode);
    expect(act.focusPane).toHaveBeenCalledWith(panes[1].id);
  });

  it("focuses a pane when keyboard focus moves into it", () => {
    const { act, onPaneContentRef, panes } = setup();
    const contentEl = onPaneContentRef.mock.calls.find(
      ([paneId, el]) => paneId === panes[0].id && el,
    )![1] as HTMLDivElement;
    const input = document.createElement("textarea");
    contentEl.appendChild(input);
    input.focus();
    expect(act.focusPane).toHaveBeenCalledWith(panes[0].id);
  });

  it("outlines only the focused pane, above its content", () => {
    const { container, panes } = setup();
    const outlined = Array.from(
      container.querySelectorAll("[data-split-pane-id]"),
    ).filter((el) => el.querySelector(".border-accent-brand\\/70"));
    expect(outlined.map((el) => el.getAttribute("data-split-pane-id"))).toEqual(
      [panes[0].id],
    );
  });

  it("runs the pane menu's actions", async () => {
    const user = userEvent.setup();
    const { container, act, panes } = setup();
    const pane = container.querySelector(
      `[data-split-pane-id="${panes[0].id}"]`,
    )!;

    await user.click(
      pane.querySelector('[aria-label="splitScreen.paneActions"]')!,
    );
    await user.click(await screen.findByText("splitScreen.closePane"));
    expect(act.closePane).toHaveBeenCalledWith(panes[0].id);

    await user.click(
      pane.querySelector('[aria-label="splitScreen.paneActions"]')!,
    );
    await user.click(await screen.findByText("splitScreen.moveToTab"));
    expect(act.moveToTab).toHaveBeenCalledWith(panes[0].id);
  });

  it("switches a pane's tab from the header dropdown", async () => {
    const user = userEvent.setup();
    const { container, act, panes } = setup();
    const pane = container.querySelector(
      `[data-split-pane-id="${panes[0].id}"]`,
    )!;
    await user.click(pane.querySelector('[title="splitScreen.showHere"]')!);
    await user.click(await screen.findByText("splitScreen.clearPane"));
    expect(act.showInPane).toHaveBeenCalledWith(panes[0].id, null);
  });

  it("splits a pane from its header", () => {
    const { container, act, panes } = setup();
    const pane = container.querySelector(
      `[data-split-pane-id="${panes[0].id}"]`,
    )!;
    fireEvent.click(
      pane.querySelector('[aria-label="splitScreen.splitDown"]')!,
    );
    expect(act.splitPane).toHaveBeenCalledWith(panes[0].id, "bottom");
  });

  it("toggles zoom from the header", () => {
    const { container, act, panes } = setup();
    const pane = container.querySelector(
      `[data-split-pane-id="${panes[0].id}"]`,
    )!;
    fireEvent.click(pane.querySelector('[aria-label="splitScreen.zoom"]')!);
    expect(act.toggleZoom).toHaveBeenCalledWith(panes[0].id);
  });

  it("evens out a group on a divider double-click", () => {
    const { container, act } = setup();
    const dividers = container.querySelectorAll('[role="separator"]');
    expect(dividers).toHaveLength(2);
    fireEvent.doubleClick(dividers[0]);
    expect(act.equalize).toHaveBeenCalled();
    expect(act.resizeEnd).toHaveBeenCalled();
  });

  it("shows only the zoomed pane", () => {
    const { container, panes } = setup({ zoom: true });
    const rendered = Array.from(
      container.querySelectorAll("[data-split-pane-id]"),
    ).map((el) => el.getAttribute("data-split-pane-id"));
    expect(rendered).toEqual([panes[1].id]);
  });

  it("on mobile shows one pane and a strip to switch panes", () => {
    const { container, act, panes } = setup({ mobile: true });
    expect(container.querySelectorAll("[data-split-pane-id]")).toHaveLength(1);
    fireEvent.click(screen.getAllByText("db-01")[0]);
    expect(act.focusPane).toHaveBeenCalledWith(panes[1].id);
  });
});
