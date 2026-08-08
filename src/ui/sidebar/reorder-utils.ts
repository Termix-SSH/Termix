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
