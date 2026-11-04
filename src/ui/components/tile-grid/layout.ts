/**
 * A tile on a 12 column grid. x and w are columns, y is unscaled px from the
 * top (the grid settles it), h is a fixed height in unscaled px or null for
 * the tile's natural height.
 */
export interface TileSlot {
  id: string;
  x: number;
  y: number;
  w: number;
  h?: number | null;
}

/** A tile with a resolved height, as the grid draws it. */
export interface TileBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const TILE_COLUMNS = 12;
export const MIN_TILE_COLUMNS = 2;
export const MIN_TILE_HEIGHT = 48;
export const MAX_TILE_HEIGHT = 10000;
/** y given to a new tile so it settles under everything else. */
export const BOTTOM = 1_000_000;

export const clampTileColumns = (w: number, min = MIN_TILE_COLUMNS) =>
  Math.max(min, Math.min(TILE_COLUMNS, Math.round(w) || min));

const overlapsX = (a: TileBox, b: TileBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w;

/**
 * Settles tiles top to bottom in (y, x) order. Each tile sits right under the
 * lowest tile placed before it in the columns it covers. Tiles never move
 * sideways and never jump above a tile that came before them.
 */
export function settleTiles(boxes: TileBox[], gap = 0): TileBox[] {
  const order = [...boxes].sort(
    (a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1),
  );
  const placed: TileBox[] = [];
  for (const box of order) {
    const y = placed.reduce(
      (top, p) => (overlapsX(p, box) ? Math.max(top, p.y + p.h + gap) : top),
      0,
    );
    placed.push({ ...box, y });
  }
  return placed;
}

export function tileBoxes(
  slots: TileSlot[],
  heights: Record<string, number>,
  fallback = 160,
): TileBox[] {
  return slots.map((slot) => ({
    id: slot.id,
    x: slot.x,
    y: slot.y,
    w: slot.w,
    h: slot.h ?? heights[slot.id] ?? fallback,
  }));
}

export function tileBottom(boxes: TileBox[], gap = 0) {
  return boxes.reduce((max, box) => Math.max(max, box.y + box.h + gap), 0);
}

/** Drops broken entries and duplicates and keeps every tile inside the grid. */
export function sanitizeTiles(
  value: unknown,
  min = MIN_TILE_COLUMNS,
): TileSlot[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: TileSlot[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const slot = raw as Record<string, unknown>;
    const id = typeof slot.id === "string" ? slot.id : "";
    if (!id || id.length > 300 || seen.has(id)) continue;
    seen.add(id);
    const w = clampTileColumns(Number(slot.w), min);
    const x = Math.max(
      0,
      Math.min(TILE_COLUMNS - w, Math.round(Number(slot.x)) || 0),
    );
    const y = Math.max(0, Number(slot.y) || 0);
    const h =
      slot.h == null || !Number.isFinite(Number(slot.h))
        ? null
        : Math.max(
            MIN_TILE_HEIGHT,
            Math.min(MAX_TILE_HEIGHT, Math.round(Number(slot.h))),
          );
    out.push({ id, x, y, w, h });
  }
  return out.slice(0, 200);
}

/** Adds a tile at the bottom, at the left. */
export function appendTile(
  slots: TileSlot[],
  tile: { id: string; w?: number; h?: number | null },
): TileSlot[] {
  if (slots.some((slot) => slot.id === tile.id)) return slots;
  return [
    ...slots,
    {
      id: tile.id,
      x: 0,
      y: BOTTOM,
      w: clampTileColumns(tile.w ?? 4),
      h: tile.h ?? null,
    },
  ];
}

export function removeTile(slots: TileSlot[], id: string): TileSlot[] {
  return slots.filter((slot) => slot.id !== id);
}

/** Writes settled positions back, in reading order. */
export function tilesFromBoxes(
  slots: TileSlot[],
  boxes: TileBox[],
): TileSlot[] {
  const byId = new Map(boxes.map((box) => [box.id, box]));
  return slots
    .map((slot) => {
      const box = byId.get(slot.id);
      return box ? { ...slot, x: box.x, y: Math.round(box.y), w: box.w } : slot;
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Lays tiles out left to right in rows, for layouts that only know an order
 * and a width (old dashboards, generated defaults).
 */
export function flowTiles(
  tiles: { id: string; w: number; h?: number | null }[],
  rowHeight = 160,
): TileSlot[] {
  const out: TileSlot[] = [];
  let x = 0;
  let row = 0;
  for (const tile of tiles) {
    const w = clampTileColumns(tile.w);
    if (x + w > TILE_COLUMNS) {
      x = 0;
      row++;
    }
    out.push({ id: tile.id, x, y: row * rowHeight, w, h: tile.h ?? null });
    x += w;
  }
  return out;
}

/** A tile's box in whole screen px. */
export interface PixelRect {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** A 1 px line the grid draws, as a box. */
export interface GridLine {
  x: number;
  y: number;
  w: number;
  h: number;
}

function mergeSpans(spans: [number, number][]): [number, number][] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/**
 * The lines between edge to edge tiles, each drawn once. A line sits on the
 * first px column or row past a tile, so it covers the edge of whatever is
 * next to it. The outer left, top and right edges are left out. With
 * `openBottom` (the grid runs to the bottom of the screen) so is the line
 * along the very bottom; a column that ends higher keeps its bottom line.
 * Lines reach one px further so corners join.
 */
export function gridLines(
  rects: PixelRect[],
  width: number,
  openBottom = false,
): GridLine[] {
  const lowest = Math.max(0, ...rects.map((rect) => rect.b));
  const end = openBottom ? lowest : Infinity;
  const vertical = new Map<number, [number, number][]>();
  const horizontal = new Map<number, [number, number][]>();
  const add = (
    map: Map<number, [number, number][]>,
    at: number,
    span: [number, number],
  ) => {
    if (span[1] <= span[0]) return;
    map.set(at, [...(map.get(at) ?? []), span]);
  };
  for (const rect of rects) {
    if (rect.r <= rect.l || rect.b <= rect.t) continue;
    const down: [number, number] = [rect.t, Math.min(end, rect.b + 1)];
    if (rect.l > 0) add(vertical, rect.l, down);
    if (rect.r < width) add(vertical, rect.r, down);
    const across: [number, number] = [rect.l, Math.min(width, rect.r + 1)];
    if (rect.t > 0) add(horizontal, rect.t, across);
    if (rect.b < end) add(horizontal, rect.b, across);
  }
  const lines: GridLine[] = [];
  for (const [x, spans] of vertical)
    for (const [start, end] of mergeSpans(spans))
      lines.push({ x, y: start, w: 1, h: end - start });
  for (const [y, spans] of horizontal)
    for (const [start, end] of mergeSpans(spans))
      lines.push({ x: start, y, w: end - start, h: 1 });
  return lines;
}
