import { describe, expect, it } from "vitest";
import {
  addPaneAtEdge,
  assignTab,
  canAddPane,
  clearTab,
  createPane,
  createSplitNode,
  createSplitState,
  equalizeSplit,
  findPaneByTab,
  focusPane,
  listPanes,
  MAX_PANES,
  MIN_PANE_SIZE,
  moveDivider,
  movePane,
  neighborPane,
  normalizeNode,
  normalizeState,
  removePane,
  resizeSplit,
  shownPanes,
  splitPane,
  swapPanes,
  toggleZoom,
  type LayoutNode,
  type SplitState,
} from "@/shell/split/split-tree";
import {
  applyPreset,
  buildPreset,
  fromLegacyConfig,
  SPLIT_PRESETS,
} from "@/shell/split/split-presets";

function tabsOf(node: LayoutNode) {
  return listPanes(node).map((pane) => pane.tabId);
}

function shape(node: LayoutNode): unknown {
  if (node.kind === "pane") return node.tabId ?? "_";
  return { [node.direction]: node.children.map(shape) };
}

function twoColumns(): SplitState {
  return createSplitState(
    createSplitNode("row", [createPane("a"), createPane("b")]),
  );
}

describe("createSplitState", () => {
  it("focuses the first empty pane, so the next pick fills it", () => {
    const state = createSplitState(
      createSplitNode("row", [createPane("a"), createPane(null)]),
    );
    expect(listPanes(state.root)[1].id).toBe(state.focusedPaneId);
  });
});

describe("splitPane", () => {
  it("wraps a lone pane in a new group", () => {
    const state = createSplitState(createPane("a"));
    const result = splitPane(state, state.focusedPaneId, "right", "b");
    expect(shape(result!.state.root)).toEqual({ row: ["a", "b"] });
    expect(result!.state.focusedPaneId).toBe(result!.paneId);
  });

  it("adds a sibling when splitting along the group's own direction", () => {
    const state = twoColumns();
    const [a] = listPanes(state.root);
    const result = splitPane(state, a.id, "left", "c")!;
    expect(shape(result.state.root)).toEqual({ row: ["c", "a", "b"] });
    const root = result.state.root;
    if (root.kind !== "split") throw new Error("expected a group");
    expect(root.sizes).toEqual([25, 25, 50]);
  });

  it("nests a group when splitting across the direction", () => {
    const state = twoColumns();
    const [, b] = listPanes(state.root);
    const result = splitPane(state, b.id, "bottom")!;
    expect(shape(result.state.root)).toEqual({
      row: ["a", { column: ["b", "_"] }],
    });
  });

  it("moves a tab out of its old pane when it is split into a new one", () => {
    const state = twoColumns();
    const [a] = listPanes(state.root);
    const result = splitPane(state, a.id, "top", "b")!;
    expect(tabsOf(result.state.root)).toEqual(["b", "a", null]);
  });

  it("refuses to go past the pane limit", () => {
    let state = createSplitState(createPane("t0"));
    for (let i = 1; i < MAX_PANES; i++) {
      state = splitPane(state, state.focusedPaneId, "right", `t${i}`)!.state;
    }
    expect(canAddPane(state)).toBe(false);
    expect(splitPane(state, state.focusedPaneId, "right")).toBeNull();
    expect(addPaneAtEdge(state, "bottom")).toBeNull();
  });

  it("clears zoom so the new pane is visible", () => {
    const state = toggleZoom(twoColumns(), listPanes(twoColumns().root)[0].id);
    const zoomed = { ...state, zoomedPaneId: state.focusedPaneId };
    const result = splitPane(zoomed, zoomed.focusedPaneId, "right")!;
    expect(result.state.zoomedPaneId).toBeNull();
  });
});

describe("addPaneAtEdge", () => {
  it("appends to a root running the same way, sharing space evenly", () => {
    const result = addPaneAtEdge(twoColumns(), "right", "c")!;
    const root = result.state.root;
    expect(shape(root)).toEqual({ row: ["a", "b", "c"] });
    if (root.kind !== "split") throw new Error("expected a group");
    root.sizes.forEach((size) => expect(size).toBeCloseTo(100 / 3));
  });

  it("wraps the whole layout when adding across it", () => {
    const result = addPaneAtEdge(twoColumns(), "bottom")!;
    expect(shape(result.state.root)).toEqual({
      column: [{ row: ["a", "b"] }, "_"],
    });
  });
});

describe("removePane", () => {
  it("collapses a group left with one child", () => {
    const state = twoColumns();
    const [a] = listPanes(state.root);
    const next = removePane(state, a.id)!;
    expect(next.root.kind).toBe("pane");
    expect(tabsOf(next.root)).toEqual(["b"]);
  });

  it("flattens a nested group into a parent running the same way", () => {
    const root = createSplitNode("row", [
      createPane("a"),
      createSplitNode("column", [
        createPane("b"),
        createSplitNode("row", [createPane("c"), createPane("d")]),
      ]),
    ]);
    const state = createSplitState(root);
    const b = findPaneByTab(state, "b")!;
    const next = removePane(state, b.id)!;
    expect(shape(next.root)).toEqual({ row: ["a", "c", "d"] });
  });

  it("returns null for the last pane, so the split closes", () => {
    const state = createSplitState(createPane("a"));
    expect(removePane(state, state.focusedPaneId)).toBeNull();
  });

  it("moves focus to a neighbour when the focused pane goes", () => {
    const state = twoColumns();
    const [a, b] = listPanes(state.root);
    const next = removePane(focusPane(state, b.id), b.id)!;
    expect(next.focusedPaneId).toBe(a.id);
  });
});

describe("tab placement", () => {
  it("assigns a tab to one pane only", () => {
    const state = twoColumns();
    const [, b] = listPanes(state.root);
    const next = assignTab(state, b.id, "a");
    expect(tabsOf(next.root)).toEqual([null, "a"]);
  });

  it("empties a pane without removing it", () => {
    const next = clearTab(twoColumns(), "a");
    expect(tabsOf(next.root)).toEqual([null, "b"]);
  });

  it("swaps two panes' tabs", () => {
    const state = twoColumns();
    const [a, b] = listPanes(state.root);
    expect(tabsOf(swapPanes(state, a.id, b.id).root)).toEqual(["b", "a"]);
  });

  it("moves a pane to another pane's edge", () => {
    const state = createSplitState(
      createSplitNode("row", [
        createPane("a"),
        createPane("b"),
        createPane("c"),
      ]),
    );
    const a = findPaneByTab(state, "a")!;
    const c = findPaneByTab(state, "c")!;
    const next = movePane(state, a.id, c.id, "bottom");
    expect(shape(next.root)).toEqual({ row: ["b", { column: ["c", "a"] }] });
  });

  it("swaps on a center drop", () => {
    const state = twoColumns();
    const [a, b] = listPanes(state.root);
    expect(tabsOf(movePane(state, a.id, b.id, "center").root)).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("sizes", () => {
  it("keeps both sides of a divider above the minimum", () => {
    expect(moveDivider([50, 50], 0, 80)).toEqual([
      100 - MIN_PANE_SIZE,
      MIN_PANE_SIZE,
    ]);
    expect(moveDivider([50, 50], 0, -80)).toEqual([
      MIN_PANE_SIZE,
      100 - MIN_PANE_SIZE,
    ]);
  });

  it("resizes and evens out one group", () => {
    const state = twoColumns();
    const id = state.root.id;
    const resized = resizeSplit(state, id, [30, 70]);
    const root = resized.root;
    if (root.kind !== "split") throw new Error("expected a group");
    expect(root.sizes).toEqual([30, 70]);
    const even = equalizeSplit(resized, id).root;
    if (even.kind !== "split") throw new Error("expected a group");
    expect(even.sizes).toEqual([50, 50]);
  });

  it("ignores sizes that do not match the children", () => {
    const state = twoColumns();
    expect(resizeSplit(state, state.root.id, [100])).toBe(state);
  });
});

describe("normalize", () => {
  it("keeps the same object when nothing needs fixing", () => {
    const state = twoColumns();
    expect(normalizeState(state)).toBe(state);
    expect(normalizeNode(state.root)).toBe(state.root);
  });

  it("empties panes whose tabs are gone and drops duplicates", () => {
    const state = createSplitState(
      createSplitNode("row", [
        createPane("a"),
        createPane("a"),
        createPane("gone"),
      ]),
    );
    const next = normalizeState(state, (id) => id !== "gone");
    expect(tabsOf(next.root)).toEqual(["a", null, null]);
  });

  it("repairs a focus that points nowhere", () => {
    const state = { ...twoColumns(), focusedPaneId: "missing" };
    const next = normalizeState(state);
    expect(next.focusedPaneId).toBe(listPanes(next.root)[0].id);
  });
});

describe("zoom and shown panes", () => {
  it("shows only the zoomed pane", () => {
    const state = twoColumns();
    const [a] = listPanes(state.root);
    const zoomed = toggleZoom(state, a.id);
    expect(shownPanes(zoomed).map((pane) => pane.id)).toEqual([a.id]);
    expect(toggleZoom(zoomed, a.id).zoomedPaneId).toBeNull();
  });

  it("shows only the focused pane when one pane fits", () => {
    const state = twoColumns();
    const [, b] = listPanes(state.root);
    const focused = focusPane(state, b.id);
    expect(shownPanes(focused, true).map((pane) => pane.id)).toEqual([b.id]);
    expect(shownPanes(focused, false)).toHaveLength(2);
  });

  it("follows focus while zoomed", () => {
    const state = twoColumns();
    const [a, b] = listPanes(state.root);
    const moved = focusPane(toggleZoom(state, a.id), b.id);
    expect(moved.zoomedPaneId).toBe(b.id);
  });
});

describe("neighborPane", () => {
  //  +---+---+
  //  | a | b |
  //  |   +---+
  //  |   | c |
  //  +---+---+
  const rects = {
    a: { left: 0, top: 0, right: 100, bottom: 200 },
    b: { left: 101, top: 0, right: 200, bottom: 100 },
    c: { left: 101, top: 101, right: 200, bottom: 200 },
  };

  it("finds panes by position in any tree shape", () => {
    expect(neighborPane("a", "right", rects)).toBe("b");
    expect(neighborPane("b", "down", rects)).toBe("c");
    expect(neighborPane("c", "up", rects)).toBe("b");
    expect(neighborPane("c", "left", rects)).toBe("a");
  });

  it("returns null at the edge", () => {
    expect(neighborPane("a", "left", rects)).toBeNull();
    expect(neighborPane("b", "up", rects)).toBeNull();
  });
});

describe("presets", () => {
  it("builds each preset with its pane count", () => {
    for (const preset of SPLIT_PRESETS) {
      expect(listPanes(buildPreset(preset.id))).toHaveLength(preset.panes);
    }
  });

  it("re-lays a split out, keeping its tabs in order", () => {
    const next = applyPreset(twoColumns(), "grid-4");
    expect(tabsOf(next.root)).toEqual(["a", "b", null, null]);
  });

  it("drops tabs past the preset's pane count", () => {
    const state = createSplitState(buildPreset("grid-4", ["a", "b", "c", "d"]));
    expect(tabsOf(applyPreset(state, "columns-2").root)).toEqual(["a", "b"]);
  });
});

describe("fromLegacyConfig", () => {
  it.each([
    ["2-way", { row: ["a", "b"] }],
    ["2-way-horizontal", { column: ["a", "b"] }],
    ["3-way", { row: ["a", { column: ["b", "c"] }] }],
    ["3-way-horizontal", { column: [{ row: ["a", "b"] }, "c"] }],
    ["4-way", { column: [{ row: ["a", "b"] }, { row: ["c", "d"] }] }],
    ["5-way", { column: [{ row: ["a", "b", "c"] }, { row: ["d", "e"] }] }],
    ["6-way", { column: [{ row: ["a", "b", "c"] }, { row: ["d", "e", "f"] }] }],
  ])("maps %s onto the tree", (mode, expected) => {
    const root = fromLegacyConfig(mode, ["a", "b", "c", "d", "e", "f"]);
    expect(shape(root!)).toEqual(expected);
  });

  it("keeps saved divider positions", () => {
    const root = fromLegacyConfig(
      "4-way",
      ["a", "b", "c", "d"],
      [30, 70],
      [
        [20, 80],
        [50, 50],
      ],
    )!;
    if (root.kind !== "split") throw new Error("expected a group");
    expect(root.sizes).toEqual([30, 70]);
    const top = root.children[0];
    if (top.kind !== "split") throw new Error("expected a group");
    expect(top.sizes).toEqual([20, 80]);
  });

  it("falls back to even sizes when the saved ones do not fit", () => {
    const root = fromLegacyConfig("2-way", ["a", "b"], "junk", [[1, 2, 3]])!;
    if (root.kind !== "split") throw new Error("expected a group");
    expect(root.sizes).toEqual([50, 50]);
  });

  it("returns null for an unknown mode", () => {
    expect(fromLegacyConfig("none", [])).toBeNull();
  });
});
