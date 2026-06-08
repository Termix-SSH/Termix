/**
 * Shared types for the CardGridCanvas: a content-agnostic, N-column masonry of
 * movable, variable-width, resizable tiles. The dashboard and Host Metrics both
 * describe their layout with these primitives.
 */

export type GridColSpan = 1 | 2 | 3;

export interface GridSlot {
  /** Stable card identifier (the consumer's card id). */
  id: string;
  /** Global order across the masonry; column placement is derived from order. */
  order: number;
  /** Tile width in grid columns (the "tetris" piece width). */
  colSpan: GridColSpan;
  /** Fixed pixel height, or null for content/auto height. */
  height: number | null;
}

export interface GridLayout {
  slots: GridSlot[];
  /** Number of masonry columns (1..4). */
  columns: number;
}

/** Catalog entry describing an addable card, used by the edit-mode Add tray. */
export interface GridCardCatalogEntry {
  id: string;
  label: string;
  description?: string;
  defaultColSpan?: GridColSpan;
  defaultHeight?: number | null;
}
