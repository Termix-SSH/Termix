import {
  createPane,
  createSplitNode,
  createSplitState,
  listPanes,
  type LayoutNode,
  type SplitState,
} from "./split-tree";

/** Starting layouts offered in the layout picker. Any pane can be split further. */
export type SplitPresetId =
  | "columns-2"
  | "rows-2"
  | "columns-3"
  | "main-left-3"
  | "main-bottom-3"
  | "grid-4"
  | "grid-5"
  | "grid-6";

export interface SplitPreset {
  id: SplitPresetId;
  titleKey: string;
  panes: number;
}

export const SPLIT_PRESETS: SplitPreset[] = [
  { id: "columns-2", titleKey: "splitScreen.presets.columns2", panes: 2 },
  { id: "rows-2", titleKey: "splitScreen.presets.rows2", panes: 2 },
  { id: "columns-3", titleKey: "splitScreen.presets.columns3", panes: 3 },
  { id: "main-left-3", titleKey: "splitScreen.presets.mainLeft3", panes: 3 },
  {
    id: "main-bottom-3",
    titleKey: "splitScreen.presets.mainBottom3",
    panes: 3,
  },
  { id: "grid-4", titleKey: "splitScreen.presets.grid4", panes: 4 },
  { id: "grid-5", titleKey: "splitScreen.presets.grid5", panes: 5 },
  { id: "grid-6", titleKey: "splitScreen.presets.grid6", panes: 6 },
];

type Sizes = { outer?: number[]; inner?: number[][] };

/**
 * Builds a preset's tree, filling panes in reading order from `tabIds`.
 * `sizes` lets the legacy mapping keep the user's divider positions.
 */
export function buildPreset(
  id: SplitPresetId,
  tabIds: (string | null)[] = [],
  sizes: Sizes = {},
): LayoutNode {
  const p = (index: number) => createPane(tabIds[index] ?? null);
  const inner = (index: number) => sizes.inner?.[index];
  switch (id) {
    case "columns-2":
      return createSplitNode("row", [p(0), p(1)], inner(0));
    case "rows-2":
      return createSplitNode("column", [p(0), p(1)], sizes.outer);
    case "columns-3":
      return createSplitNode("row", [p(0), p(1), p(2)], inner(0));
    case "main-left-3": {
      const first = inner(0)?.[0];
      return createSplitNode(
        "row",
        [p(0), createSplitNode("column", [p(1), p(2)], sizes.outer)],
        first !== undefined ? [first, 100 - first] : undefined,
      );
    }
    case "main-bottom-3":
      return createSplitNode(
        "column",
        [createSplitNode("row", [p(0), p(1)], inner(0)), p(2)],
        sizes.outer,
      );
    case "grid-4":
      return createSplitNode(
        "column",
        [
          createSplitNode("row", [p(0), p(1)], inner(0)),
          createSplitNode("row", [p(2), p(3)], inner(1)),
        ],
        sizes.outer,
      );
    case "grid-5":
      return createSplitNode(
        "column",
        [
          createSplitNode("row", [p(0), p(1), p(2)], inner(0)),
          createSplitNode("row", [p(3), p(4)], inner(1)),
        ],
        sizes.outer,
      );
    case "grid-6":
      return createSplitNode(
        "column",
        [
          createSplitNode("row", [p(0), p(1), p(2)], inner(0)),
          createSplitNode("row", [p(3), p(4), p(5)], inner(1)),
        ],
        sizes.outer,
      );
  }
}

/**
 * Re-lays an existing split out as a preset, keeping its tabs in reading
 * order. Tabs past the preset's pane count drop out of the split.
 */
export function applyPreset(state: SplitState, id: SplitPresetId): SplitState {
  const tabIds = listPanes(state.root).flatMap((pane) =>
    pane.tabId ? [pane.tabId] : [],
  );
  return createSplitState(buildPreset(id, tabIds));
}

/** Split modes from before the layout tree, still found in storage and old workspaces. */
export type LegacySplitMode =
  | "2-way"
  | "2-way-horizontal"
  | "3-way"
  | "3-way-horizontal"
  | "4-way"
  | "5-way"
  | "6-way";

const LEGACY_PRESETS: Record<LegacySplitMode, SplitPresetId> = {
  "2-way": "columns-2",
  "2-way-horizontal": "rows-2",
  "3-way": "main-left-3",
  "3-way-horizontal": "main-bottom-3",
  "4-way": "grid-4",
  "5-way": "grid-5",
  "6-way": "grid-6",
};

function validSizes(value: unknown): number[] | undefined {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every((n) => typeof n === "number" && n > 0)
    ? value
    : undefined;
}

/** Maps an old fixed-mode split onto the tree, keeping sizes where they fit. */
export function fromLegacyConfig(
  mode: string,
  paneTabIds: (string | null)[],
  rowSizes?: unknown,
  rowColSizes?: unknown,
): LayoutNode | null {
  const presetId = LEGACY_PRESETS[mode as LegacySplitMode];
  if (!presetId) return null;
  const inner = Array.isArray(rowColSizes)
    ? rowColSizes.map((row) => validSizes(row) ?? [])
    : undefined;
  return buildPreset(presetId, paneTabIds, {
    outer: validSizes(rowSizes),
    inner: inner?.map((row) => (row.length > 0 ? row : undefined)) as
      number[][] | undefined,
  });
}
