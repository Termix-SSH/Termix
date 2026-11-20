/**
 * Whether an admin lets community layouts and themes run in the page, like
 * official ones, instead of a sandboxed frame. A layout draws the whole app,
 * so one in the page can read anything the page can. Off by default.
 */

const KEY = "plugins_community_looks";

let allowed = false;

async function settings() {
  const { createCurrentSettingsRepository } =
    await import("../database/repositories/factory.js");
  return createCurrentSettingsRepository();
}

/** Reads the saved choice. Called once at startup. */
export async function loadCommunityLooks(): Promise<boolean> {
  try {
    allowed = (await (await settings()).get(KEY)) === "true";
  } catch {
    allowed = false;
  }
  return allowed;
}

export function communityLooksAllowed(): boolean {
  return allowed;
}

export async function setCommunityLooks(on: boolean): Promise<boolean> {
  await (await settings()).set(KEY, on ? "true" : "false");
  allowed = on;
  return allowed;
}

/** Test seam. */
export function resetCommunityLooks(on = false): void {
  allowed = on;
}
