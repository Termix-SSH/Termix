import { isMacPlatform } from "./tab-jump-hotkey";

export type PaneNavDirection = "left" | "right" | "up" | "down";

const ARROWS: Record<string, PaneNavDirection> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

/**
 * The split pane to move to for this key, if any. Cmd+Option+Arrow on macOS,
 * where Option+Arrow moves the shell cursor by word, Alt+Arrow elsewhere.
 */
export function getPaneNavDirection(e: KeyboardEvent): PaneNavDirection | null {
  const direction = ARROWS[e.code];
  if (!direction || e.ctrlKey || e.shiftKey || !e.altKey) return null;
  if (e.metaKey !== isMacPlatform()) return null;
  return direction;
}

export function paneNavHotkeyLabel(): string {
  return isMacPlatform() ? "Cmd+Option+Arrows" : "Alt+Arrows";
}
