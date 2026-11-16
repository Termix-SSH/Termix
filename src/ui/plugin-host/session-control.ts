/**
 * Ending or restarting the shell's session for a login policy plugin
 * (auth:policy): signing out after idle time, or starting again once a
 * required second factor is set up. A plugin in a frame can't reload or log
 * out the window itself, so the shell does it for plugins with that
 * capability only, and reloads at most once every ten seconds.
 */

import { logoutUser } from "@/main-axios";

const RELOAD_GAP_MS = 10_000;
let lastReload = 0;

export function mayControlSession(capabilities: readonly string[]): boolean {
  return capabilities.includes("auth:policy");
}

export function reloadShell(): boolean {
  const now = Date.now();
  if (now - lastReload < RELOAD_GAP_MS) return false;
  lastReload = now;
  window.location.reload();
  return true;
}

export async function signOutShell(): Promise<void> {
  await logoutUser().catch(() => {});
  lastReload = Date.now();
  window.location.reload();
}

/** Test seam. */
export function resetSessionControl(): void {
  lastReload = 0;
}
