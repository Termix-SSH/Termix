import type { LookResponse } from "@/api/look-api";

/** The theme a fresh install starts in when nothing else says otherwise. */
export const FALLBACK_THEME = "dark";

/**
 * The layout to show: the user's choice, else the admin default, else the
 * default look. Empty when none of them names one, which the repair view
 * answers. Without an answer from the server the last layout this browser
 * showed stands in.
 */
export function resolveLayoutId(
  look: LookResponse | null,
  lastShown: string | null = null,
): string {
  if (!look) return lastShown ?? "";
  return look.layoutId ?? look.defaults.layout ?? look.defaultLook.layout ?? "";
}

/**
 * The theme to show: the user's choice, else the one this browser kept
 * (today's per-device setting, so existing users see no change), else the
 * admin default, else the layout's own, else the default look's.
 */
export function resolveThemeId(
  look: LookResponse | null,
  localTheme: string | null,
  layoutDefaultTheme?: string,
): string {
  return (
    look?.themeId ??
    localTheme ??
    look?.defaults.theme ??
    layoutDefaultTheme ??
    look?.defaultLook.theme ??
    FALLBACK_THEME
  );
}

/** ?safe-layout=1 in the address bar opens the repair view. */
export function safeLayoutInUrl(search: string): boolean {
  const value = new URLSearchParams(search).get("safe-layout");
  return value === "1" || value === "true";
}
