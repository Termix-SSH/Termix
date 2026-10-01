import { ANNOUNCEMENT_SOURCE } from "../types";

export function timeAgo(iso: string, language: string): string {
  // SQLite's CURRENT_TIMESTAMP has no zone; it is UTC.
  const normalized = /[zZ]|[+-]\d\d:?\d\d$/.test(iso)
    ? iso
    : `${iso.replace(" ", "T")}Z`;
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return "";
  const seconds = Math.round((ms - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(language || "en", {
    numeric: "auto",
  });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, "second");
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return format.format(Math.round(seconds / 3600), "hour");
  return format.format(Math.round(seconds / 86400), "day");
}

export function sourceLabel(
  source: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (source === ANNOUNCEMENT_SOURCE) return t("inbox.sourceTermix");
  return source
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
