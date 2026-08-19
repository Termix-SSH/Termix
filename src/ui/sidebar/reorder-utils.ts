/**
 * Manual drag-to-reorder position math, shared by host and folder reordering.
 * Sparse integers (gaps of 1000) mean most drops only rewrite the moved
 * item's own sortOrder -- inserting between two neighbors is just the
 * midpoint between their values. Renumbering the whole sibling group only
 * happens when a gap runs out (two adjacent siblings differ by 1).
 */

const GAP = 1000;

export interface Orderable {
  sortOrder?: number | null;
}

/**
 * Computes the sortOrder for an item dropped between `before` and `after`
 * (either may be absent for a drop at the start/end of the list). Returns
 * null when the gap between neighbors has been exhausted and the caller
 * should renumber the whole sibling group instead via renumberSiblings.
 */
export function computeDropSortOrder(
  before: Orderable | null,
  after: Orderable | null,
): number | null {
  const beforeOrder = before?.sortOrder ?? null;
  const afterOrder = after?.sortOrder ?? null;

  if (beforeOrder == null && afterOrder == null) return GAP;
  if (beforeOrder == null) return (afterOrder as number) - GAP;
  if (afterOrder == null) return beforeOrder + GAP;

  const mid = Math.floor((beforeOrder + afterOrder) / 2);
  if (mid <= beforeOrder || mid >= afterOrder) return null;
  return mid;
}

/**
 * Assigns fresh, evenly-spaced sortOrder values (0, GAP, 2*GAP, ...) to an
 * ordered list of sibling ids, for when computeDropSortOrder signals the
 * available gap is exhausted.
 */
export function renumberSiblings<T extends { id: string | number }>(
  orderedIds: T[],
): { id: string | number; sortOrder: number }[] {
  return orderedIds.map((item, index) => ({
    id: item.id,
    sortOrder: index * GAP,
  }));
}

export type ReorderKind = "host" | "folder" | "cred";

export interface ReorderRow {
  /** Stable key, e.g. "host:12" or "folder:Prod / Web". */
  key: string;
  /** Identifies the row's parent so siblings can be scoped to one group. */
  parentKey: string;
  sortOrder?: number | null;
}

export interface ReorderPlan {
  /** Rows to write, already carrying their new sortOrder. */
  positions: { key: string; sortOrder: number }[];
  /** New parent for the dragged row, when the drop crossed groups. */
  movedTo: string | null;
}

/**
 * Resolves a drop into the exact writes it implies.
 *
 * Siblings are scoped to the drop target's parent, not to every row of the
 * same type -- dropping onto a row in another folder has to compare against
 * that folder's own neighbors, and reports the parent change so the caller
 * can persist the move alongside the new position.
 *
 * Returns null when the drop is a no-op (unknown rows, or dropping an item
 * back onto the slot it already occupies).
 */
export function planReorder(
  rows: ReorderRow[],
  draggedKey: string,
  targetKey: string,
  position: "before" | "after",
): ReorderPlan | null {
  if (draggedKey === targetKey) return null;

  const dragged = rows.find((r) => r.key === draggedKey);
  const target = rows.find((r) => r.key === targetKey);
  if (!dragged || !target) return null;

  const siblings = rows.filter((r) => r.parentKey === target.parentKey);
  const targetIndex = siblings.findIndex((r) => r.key === targetKey);
  if (targetIndex === -1) return null;

  const before =
    position === "before" ? (siblings[targetIndex - 1] ?? null) : target;
  const after =
    position === "before" ? target : (siblings[targetIndex + 1] ?? null);

  // Already sitting exactly where the drop would put it.
  if (before?.key === draggedKey || after?.key === draggedKey) return null;

  const movedTo =
    dragged.parentKey === target.parentKey ? null : target.parentKey;

  // Hosts start life with sortOrder null, and null sorts last in manual
  // mode. Writing a single value for the moved row against null neighbours
  // therefore says nothing about where it landed -- the group has to be
  // numbered as a whole before any position is meaningful. A cross-folder
  // drop renumbers for the same reason: the dragged row arrives carrying a
  // sortOrder from its old folder, which means nothing in this one.
  const needsFullRenumber =
    movedTo !== null ||
    siblings.some((r) => r.key !== draggedKey && r.sortOrder == null);

  const sortOrder = needsFullRenumber
    ? null
    : computeDropSortOrder(
        before && before.key !== draggedKey ? before : null,
        after && after.key !== draggedKey ? after : null,
      );

  if (sortOrder !== null) {
    return { positions: [{ key: draggedKey, sortOrder }], movedTo };
  }

  // Gap exhausted: renumber the whole destination group with the dragged row
  // spliced into its new slot.
  const ordered = siblings.filter((r) => r.key !== draggedKey);
  const targetPos = ordered.findIndex((r) => r.key === targetKey);
  const insertAt = position === "before" ? targetPos : targetPos + 1;
  ordered.splice(insertAt, 0, dragged);

  return {
    positions: renumberSiblings(ordered.map((r) => ({ id: r.key }))).map(
      (r) => ({ key: String(r.id), sortOrder: r.sortOrder }),
    ),
    movedTo,
  };
}
