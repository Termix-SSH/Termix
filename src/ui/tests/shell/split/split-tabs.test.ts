import { describe, expect, it } from "vitest";
import type { Tab } from "@/types/ui-types";
import {
  addSplitTab,
  closeSplitTab,
  isSplitTab,
  makeSplitTab,
  nextSplitNumber,
  placeTabInPane,
  removeTab,
  restoreSplitTabs,
  serializeSplitTabs,
  splitTabOf,
  summarizeSplits,
  syncSplitChildren,
  updateSplit,
  type SplitTab,
} from "@/shell/split/split-tabs";
import {
  createPane,
  createSplitNode,
  createSplitState,
  listPanes,
  removePane,
} from "@/shell/split/split-tree";

function tab(id: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    instanceId: `inst-${id}`,
    type: "terminal",
    label: id,
    openedAt: 0,
    ...overrides,
  } as Tab;
}

function split(id: string, tabIds: (string | null)[]): SplitTab {
  return makeSplitTab(
    id,
    `Split ${id}`,
    createSplitState(
      createSplitNode(
        "row",
        tabIds.map((tabId) => createPane(tabId)),
      ),
    ),
    0,
  );
}

function paneTabs(tabs: Tab[], splitId: string) {
  const found = tabs.find((t) => t.id === splitId);
  if (!isSplitTab(found)) return null;
  return listPanes(found.split.root).map((pane) => pane.tabId);
}

const dashboard = tab("dashboard", { type: "dashboard" });

describe("syncSplitChildren", () => {
  it("marks tabs in panes and releases the rest", () => {
    const tabs = syncSplitChildren([
      tab("a"),
      tab("b", { parentSplitTabId: "split-x" }),
      split("x", ["a", null]),
    ]);
    expect(tabs.find((t) => t.id === "a")?.parentSplitTabId).toBe("split-x");
    expect(tabs.find((t) => t.id === "b")?.parentSplitTabId).toBeUndefined();
  });

  it("keeps a tab claimed by two splits with the first", () => {
    const tabs = syncSplitChildren([
      tab("a"),
      split("x", ["a"]),
      split("y", ["a", null]),
    ]);
    expect(paneTabs(tabs, "split-x")).toEqual(["a"]);
    expect(paneTabs(tabs, "split-y")).toEqual([null, null]);
  });

  it("never holds the dashboard or another split in a pane", () => {
    const tabs = syncSplitChildren([
      dashboard,
      split("inner", [null]),
      split("x", ["dashboard", "split-inner"]),
    ]);
    expect(paneTabs(tabs, "split-x")).toEqual([null, null]);
  });

  it("returns the same array when nothing changes", () => {
    const tabs = syncSplitChildren([tab("a"), split("x", ["a"])]);
    expect(syncSplitChildren(tabs)).toBe(tabs);
  });
});

describe("adding and closing", () => {
  it("adds a split and takes its tabs out of other splits", () => {
    let tabs = addSplitTab([tab("a"), tab("b")], split("x", ["a", "b"]));
    tabs = addSplitTab(tabs, split("y", ["b", null]));
    expect(paneTabs(tabs, "split-x")).toEqual(["a", null]);
    expect(paneTabs(tabs, "split-y")).toEqual(["b", null]);
    expect(splitTabOf(tabs, "b")?.id).toBe("split-y");
  });

  it("releases every tab when a split closes", () => {
    const tabs = closeSplitTab(
      addSplitTab([tab("a"), tab("b")], split("x", ["a", "b"])),
      "split-x",
    );
    expect(tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(tabs.every((t) => !t.parentSplitTabId)).toBe(true);
  });

  it("leaves an empty, focused pane when a tab in it closes", () => {
    const tabs = removeTab(
      addSplitTab([tab("a"), tab("b")], split("x", ["a", "b"])),
      "b",
    );
    const s = tabs.find((t) => t.id === "split-x") as SplitTab;
    const panes = listPanes(s.split.root);
    expect(panes.map((pane) => pane.tabId)).toEqual(["a", null]);
    expect(s.split.focusedPaneId).toBe(panes[1].id);
    expect(tabs.some((t) => t.id === "b")).toBe(false);
  });

  it("closes the split when an update removes its last pane", () => {
    const tabs = addSplitTab([tab("a")], split("x", ["a"]));
    const next = updateSplit(tabs, "split-x", (state) =>
      removePane(state, state.focusedPaneId),
    );
    expect(next.some((t) => t.id === "split-x")).toBe(false);
    expect(next.find((t) => t.id === "a")?.parentSplitTabId).toBeUndefined();
  });
});

describe("placeTabInPane", () => {
  it("fills the pane and focuses it", () => {
    const tabs = addSplitTab([tab("a"), tab("b")], split("x", ["a", null]));
    const s = tabs.find((t) => t.id === "split-x") as SplitTab;
    const empty = listPanes(s.split.root)[1];
    const next = placeTabInPane(tabs, "split-x", empty.id, "b");
    const updated = next.find((t) => t.id === "split-x") as SplitTab;
    expect(paneTabs(next, "split-x")).toEqual(["a", "b"]);
    expect(updated.split.focusedPaneId).toBe(empty.id);
    expect(next.find((t) => t.id === "b")?.parentSplitTabId).toBe("split-x");
  });

  it("sends a replaced tab back to the tab bar", () => {
    const tabs = addSplitTab([tab("a"), tab("b")], split("x", ["a"]));
    const s = tabs.find((t) => t.id === "split-x") as SplitTab;
    const next = placeTabInPane(
      tabs,
      "split-x",
      listPanes(s.split.root)[0].id,
      "b",
    );
    expect(next.find((t) => t.id === "a")?.parentSplitTabId).toBeUndefined();
  });

  it("refuses the dashboard", () => {
    const tabs = addSplitTab([dashboard], split("x", [null]));
    const s = tabs.find((t) => t.id === "split-x") as SplitTab;
    const pane = listPanes(s.split.root)[0];
    expect(placeTabInPane(tabs, "split-x", pane.id, "dashboard")).toBe(tabs);
  });
});

describe("labels and summaries", () => {
  it("picks the lowest unused split number", () => {
    const labelFor = (n: number) => `Split ${n}`;
    const tabs = [
      { ...split("a", [null]), label: "Split 1" },
      { ...split("b", [null]), label: "Split 3" },
    ];
    expect(nextSplitNumber(tabs, labelFor)).toBe(2);
  });

  it("summarizes panes with their tab labels", () => {
    const tabs = addSplitTab(
      [tab("a", { label: "web-01", customLabel: "prod" })],
      split("x", ["a", null]),
    );
    const [summary] = summarizeSplits(tabs, 8);
    expect(summary.panes.map((pane) => [pane.index, pane.label])).toEqual([
      [1, "prod"],
      [2, null],
    ]);
    expect(summary.full).toBe(false);
    expect(summarizeSplits(tabs, 2)[0].full).toBe(true);
  });
});

describe("persistence", () => {
  it("round-trips a split through instance ids", () => {
    const tabs = addSplitTab([tab("a"), tab("b")], split("x", ["a", null]));
    const saved = serializeSplitTabs(tabs);
    expect(saved[0].version).toBe(2);
    expect(listPanes(saved[0].root).map((pane) => pane.tabId)).toEqual([
      "inst-a",
      null,
    ]);

    // After a reload, tabs come back with new live ids but the same instanceIds.
    const reloaded = [
      tab("a2", { instanceId: "inst-a" }),
      tab("b2", { instanceId: "inst-b" }),
    ];
    const restored = restoreSplitTabs(
      JSON.parse(JSON.stringify(saved)),
      reloaded,
    );
    const restoredSplit = restored.find(isSplitTab)!;
    expect(restoredSplit.label).toBe("Split x");
    expect(listPanes(restoredSplit.split.root).map((p) => p.tabId)).toEqual([
      "a2",
      null,
    ]);
    expect(restored.find((t) => t.id === "a2")?.parentSplitTabId).toBe(
      restoredSplit.id,
    );
  });

  it("restores the fixed-mode shape saved before the layout tree", () => {
    const restored = restoreSplitTabs(
      [
        {
          instanceId: "old",
          label: "Split 1",
          mode: "3-way-horizontal",
          paneInstanceIds: ["inst-a", "inst-b", "inst-c", null, null, null],
          rowSizes: [50, 50],
          rowColSizes: [[50, 50], [100]],
        },
      ],
      [tab("a"), tab("b"), tab("c")],
    );
    const restoredSplit = restored.find(isSplitTab)!;
    expect(restoredSplit.id).toBe("split-old");
    expect(listPanes(restoredSplit.split.root).map((p) => p.tabId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("skips entries whose tabs are gone or that are unreadable", () => {
    const restored = restoreSplitTabs(
      [
        {
          instanceId: "x",
          label: "Gone",
          mode: "2-way",
          paneInstanceIds: ["nope"],
        },
        { instanceId: "y", label: "Junk", root: { kind: "weird" } },
        "not an object",
      ],
      [tab("a")],
    );
    expect(restored.some(isSplitTab)).toBe(false);
  });

  it("does not restore a split that is already open", () => {
    const tabs = addSplitTab([tab("a")], split("x", ["a"]));
    const saved = serializeSplitTabs(tabs);
    expect(restoreSplitTabs(saved, tabs)).toBe(tabs);
  });
});
