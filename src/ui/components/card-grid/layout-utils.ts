import type { GridSlot, GridColSpan, GridCardCatalogEntry } from "./types";

export const MIN_TILE_HEIGHT = 80;
export const MAX_COLUMNS = 4;
export const MIN_COLUMNS = 1;

export function clampColumns(n: number): number {
  if (!Number.isFinite(n)) return MIN_COLUMNS;
  return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.round(n)));
}

/** Cycle a tile width 1 -> 2 -> 3 -> 1, capped at the available column count. */
export function nextColSpan(
  current: GridColSpan,
  columns: number,
): GridColSpan {
  const max = Math.min(3, Math.max(1, columns)) as GridColSpan;
  return (((current % max) + 1) as GridColSpan) || 1;
}

/** Sort slots by order ascending (stable copy). */
export function sortSlots(slots: GridSlot[]): GridSlot[] {
  return [...slots].sort((a, b) => a.order - b.order);
}

/**
 * Move the dragged slot so it lands at `targetOrder`, then renumber every slot's
 * order to a dense 0..n-1 sequence (the masonry placement is derived from order).
 */
export function reorderSlots(
  slots: GridSlot[],
  draggedId: string,
  targetOrder: number,
): GridSlot[] {
  const moved = slots.find((s) => s.id === draggedId);
  if (!moved) return sortSlots(slots).map((s, i) => ({ ...s, order: i }));
  const without = sortSlots(slots).filter((s) => s.id !== draggedId);
  const insertIdx = without.findIndex((s) => s.order >= targetOrder);
  const at = insertIdx === -1 ? without.length : insertIdx;
  return [...without.slice(0, at), moved, ...without.slice(at)].map((s, i) => ({
    ...s,
    order: i,
  }));
}

/** Append a catalog card as a new slot, clamping its width to the column count. */
export function addSlot(
  slots: GridSlot[],
  entry: GridCardCatalogEntry,
  columns: number,
): GridSlot[] {
  if (slots.some((s) => s.id === entry.id)) return slots;
  const maxOrder = slots.reduce((m, s) => Math.max(m, s.order), -1);
  const colSpan = Math.min(
    entry.defaultColSpan ?? 1,
    Math.min(3, Math.max(1, columns)),
  ) as GridColSpan;
  return [
    ...slots,
    {
      id: entry.id,
      order: maxOrder + 1,
      colSpan,
      height: entry.defaultHeight ?? null,
    },
  ];
}

export function removeSlot(slots: GridSlot[], id: string): GridSlot[] {
  return slots
    .filter((s) => s.id !== id)
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({ ...s, order: i }));
}

export function setColSpan(
  slots: GridSlot[],
  id: string,
  colSpan: GridColSpan,
): GridSlot[] {
  return slots.map((s) => (s.id === id ? { ...s, colSpan } : s));
}

export function setHeight(
  slots: GridSlot[],
  id: string,
  height: number,
): GridSlot[] {
  const h = Math.max(MIN_TILE_HEIGHT, Math.round(height));
  return slots.map((s) => (s.id === id ? { ...s, height: h } : s));
}

/**
 * Convert a tile pixel height into the number of grid rows it should span for
 * the masonry (row-span) layout. The grid uses `rowUnit`px rows separated by
 * `rowGap`px, so a tile of height H occupies ceil((H + gap) / (unit + gap))
 * rows. Kept pure for unit testing the packing math.
 */
export function heightToRowSpan(
  height: number,
  rowUnit: number,
  rowGap: number,
): number {
  return Math.max(1, Math.ceil((height + rowGap) / (rowUnit + rowGap)));
}
