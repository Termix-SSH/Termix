export const TERMINAL_FONT_ZOOM_MIN = 8;
export const TERMINAL_FONT_ZOOM_MAX = 36;

export function clampTerminalFontSize(fontSize: number, direction: 1 | -1) {
  return Math.min(
    TERMINAL_FONT_ZOOM_MAX,
    Math.max(TERMINAL_FONT_ZOOM_MIN, fontSize + direction),
  );
}

export function getTerminalFontZoomDirection(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey">,
): 1 | -1 | null {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return null;

  if (event.key === "+" || event.code === "NumpadAdd") return 1;
  if (event.key === "-" || event.code === "NumpadSubtract") return -1;

  return null;
}
