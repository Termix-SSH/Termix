import { arePluginThemesKnown, type ThemeDef } from "./theme-registry";

const LINK_ID = "termix-theme-css";
/** The last plugin theme's stylesheet, so a reload shows it before login too. */
const CACHE_KEY = "termix-theme-css";

function readCache(): { id: string; href: string } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (
      parsed &&
      typeof (parsed as { id?: unknown }).id === "string" &&
      typeof (parsed as { href?: unknown }).href === "string"
    ) {
      return parsed as { id: string; href: string };
    }
  } catch {
    // Unreadable or private mode.
  }
  return null;
}

function writeCache(value: { id: string; href: string } | null) {
  try {
    if (value) localStorage.setItem(CACHE_KEY, JSON.stringify(value));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // Private mode; the theme still applies once plugins load.
  }
}

/**
 * Loads the one plugin theme stylesheet the shown theme needs, and only that
 * one. Built-in themes need none. A theme whose plugin has not loaded yet
 * keeps the stylesheet it had last time.
 */
export function applyThemeCss(id: string, theme: ThemeDef | undefined): void {
  if (typeof document === "undefined") return;
  const cached = readCache();
  let href: string | null = null;
  if (theme?.cssHref) {
    href = theme.cssHref;
    writeCache({ id, href });
  } else if (cached?.id === id && !arePluginThemesKnown()) {
    // Its plugin has not said yet whether it still provides this theme.
    href = cached.href;
  } else if (cached && arePluginThemesKnown()) {
    writeCache(null);
  }

  let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
  if (!href) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.id = LINK_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  const absolute = new URL(href, window.location.href).href;
  if (link.href !== absolute) link.href = absolute;
}
