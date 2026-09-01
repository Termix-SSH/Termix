import type { TFunction } from "i18next";

export function formatRelativeTime(
  unixSeconds: number,
  nowMs: number,
  t: TFunction,
): string {
  if (!unixSeconds) return "";
  const diff = Math.max(0, nowMs / 1000 - unixSeconds);
  if (diff < 60) return String(t("tmuxMonitor.timeJustNow"));
  if (diff < 3600)
    return String(
      t("tmuxMonitor.timeMinutes", { count: Math.floor(diff / 60) }),
    );
  if (diff < 86400)
    return String(
      t("tmuxMonitor.timeHours", { count: Math.floor(diff / 3600) }),
    );
  return String(t("tmuxMonitor.timeDays", { count: Math.floor(diff / 86400) }));
}

export function formatMem(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${kb} KB`;
}
