/**
 * Brings a signed-out full-screen `?view=` link back after sign-in. The link
 * waits in sessionStorage, which survives a redirect login in the same tab,
 * so no return path is ever sent to the server.
 */

const PENDING_VIEW_LINK_KEY = "termix-pending-view-link";

/** The value as a same-origin path with a `view` parameter, or null. */
export function toViewLinkPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(value, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (!url.searchParams.get("view")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function rememberViewLink(): void {
  const { pathname, search, hash } = window.location;
  const path = toViewLinkPath(`${pathname}${search}${hash}`);
  if (!path) return;
  try {
    sessionStorage.setItem(PENDING_VIEW_LINK_KEY, path);
  } catch {
    // Without storage the user just lands on the app after signing in.
  }
}

/** The remembered link, cleared whether or not it is still valid. */
export function consumeViewLink(): string | null {
  try {
    const stored = sessionStorage.getItem(PENDING_VIEW_LINK_KEY);
    sessionStorage.removeItem(PENDING_VIEW_LINK_KEY);
    return toViewLinkPath(stored);
  } catch {
    return null;
  }
}

/**
 * Opens the remembered link, if there is one. The navigation waits a tick so
 * history updates the login callback makes right after sign-in cannot cancel
 * it.
 */
export function resumeViewLink(): boolean {
  const path = consumeViewLink();
  if (!path) return false;
  setTimeout(() => window.location.replace(path), 0);
  return true;
}
