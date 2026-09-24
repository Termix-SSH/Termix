export const TERMINAL_FONT_ZOOM_MIN = 8;
export const TERMINAL_FONT_ZOOM_MAX = 36;

type ZoomKeyEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "key" | "metaKey"
>;

export function getTerminalFontZoomDirection(event: ZoomKeyEvent): -1 | 0 | 1 {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return 0;

  if (
    event.key === "+" ||
    event.code === "Equal" ||
    event.code === "NumpadAdd"
  ) {
    return 1;
  }
  if (
    event.key === "-" ||
    event.code === "Minus" ||
    event.code === "NumpadSubtract"
  ) {
    return -1;
  }
  return 0;
}

export function getNextTerminalFontSize(
  currentFontSize: number,
  direction: -1 | 1,
): number {
  return Math.min(
    TERMINAL_FONT_ZOOM_MAX,
    Math.max(TERMINAL_FONT_ZOOM_MIN, currentFontSize + direction),
  );
}
