import type { SelectedPane } from "./types";

const PREFIX = "termix-tmux-monitor-";
export function readMonitorValue<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(PREFIX + key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}
export function saveMonitorValue(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* unavailable */
  }
}
export function readExpanded(hostId: number | string): Set<string> | null {
  const value = readMonitorValue<unknown>(`expanded-${hostId}`, null);
  return Array.isArray(value)
    ? new Set(value.filter((v): v is string => typeof v === "string"))
    : null;
}
export function readSelectedPane(hostId: number | string): SelectedPane | null {
  const value = readMonitorValue<Partial<SelectedPane> | null>(
    `pane-${hostId}`,
    null,
  );
  return value &&
    typeof value.paneId === "string" &&
    typeof value.sessionName === "string" &&
    Number.isInteger(value.windowIndex)
    ? (value as SelectedPane)
    : null;
}
