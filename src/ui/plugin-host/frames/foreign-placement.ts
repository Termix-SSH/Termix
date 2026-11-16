/**
 * Where the shell draws a foreign view: the placeholder's rect from the
 * consumer frame, moved to the page, clipped to what the consumer frame shows
 * and to what the consumer's own scroll boxes show. Pure math, no DOM.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

/** Largest coordinate or size taken from a frame, in CSS pixels. */
export const MAX_COORD = 100_000;

export function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return { x, y, width: 0, height: 0 };
  return { x, y, width: right - x, height: bottom - y };
}

export function isEmpty(rect: Rect): boolean {
  return !(rect.width > 0 && rect.height > 0);
}

/** A rect a frame sent, or null when it is not one. */
export function readRect(value: unknown): Rect | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  const nums = [x, y, width, height];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return null;
  }
  const clamp = (n: number) => Math.max(-MAX_COORD, Math.min(MAX_COORD, n));
  return {
    x: clamp(x as number),
    y: clamp(y as number),
    width: Math.max(0, clamp(width as number)),
    height: Math.max(0, clamp(height as number)),
  };
}

/** The part of the consumer frame the page shows: its rect cut by every box that clips it. */
export function visibleBox(frame: Rect, clips: Rect[]): Rect {
  let box = frame;
  for (const clip of clips) box = intersect(box, clip);
  return box;
}

export interface Placement {
  rect: Rect;
  /** What the consumer's own scroll boxes show of the placeholder, frame coords. */
  clip: Rect | null;
  visible: boolean;
}

export interface PlaceInput {
  /** Consumer iframe in the page. */
  frame: Rect;
  /** visibleBox of the consumer, in the page. */
  box: Rect;
  frameShown: boolean;
  placement: Placement;
  /** Open menus and popovers of the consumer, frame coords. */
  occluders: Rect[];
  /** The provider view draws something (always true unless it can be empty). */
  drawn: boolean;
}

export interface PlaceOutput {
  hidden: boolean;
  /** Relative to the layer, which sits at `box`. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** inset() for clip-path, relative to the view. */
  clipPath: string;
  /** The part that may show, in the page, for views CSS can't clip. */
  shownInPage: Rect;
}

export function placeView(input: PlaceInput): PlaceOutput {
  const { frame, box, placement } = input;
  const rect = placement.rect;
  const left = frame.x + rect.x - box.x;
  const top = frame.y + rect.y - box.y;
  const out = {
    left,
    top,
    width: rect.width,
    height: rect.height,
  };
  // What may show, in frame coords: the placeholder, cut by the consumer's
  // scroll boxes and by the part of the frame the page shows.
  const frameBox: Rect = {
    x: box.x - frame.x,
    y: box.y - frame.y,
    width: box.width,
    height: box.height,
  };
  let shown = intersect(rect, frameBox);
  if (placement.clip) shown = intersect(shown, placement.clip);
  const occluded = input.occluders.some(
    (occluder) => !isEmpty(intersect(occluder, shown)),
  );
  const hidden =
    !input.frameShown ||
    isEmpty(box) ||
    !placement.visible ||
    !input.drawn ||
    isEmpty(shown) ||
    occluded;
  const inset = (n: number) => `${Math.max(0, Math.round(n * 100) / 100)}px`;
  const clipPath = isEmpty(shown)
    ? "inset(100%)"
    : `inset(${inset(shown.y - rect.y)} ${inset(
        rect.x + rect.width - (shown.x + shown.width),
      )} ${inset(rect.y + rect.height - (shown.y + shown.height))} ${inset(
        shown.x - rect.x,
      )})`;
  const shownInPage: Rect = {
    x: frame.x + shown.x,
    y: frame.y + shown.y,
    width: shown.width,
    height: shown.height,
  };
  return { hidden, ...out, clipPath, shownInPage };
}
