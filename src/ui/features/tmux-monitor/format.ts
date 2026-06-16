export function formatRelativeTime(
  unixSeconds: number,
  nowMs: number,
  t: (k: string, o?: object) => string,
): string {
  if (!unixSeconds) return "";
  const diff = Math.max(0, nowMs / 1000 - unixSeconds);
  if (diff < 60) return t("tmuxMonitor.timeJustNow");
  if (diff < 3600)
    return t("tmuxMonitor.timeMinutes", { count: Math.floor(diff / 60) });
  if (diff < 86400)
    return t("tmuxMonitor.timeHours", { count: Math.floor(diff / 3600) });
  return t("tmuxMonitor.timeDays", { count: Math.floor(diff / 86400) });
}

export function formatMem(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${kb} KB`;
}
