/**
 * Tells desktop users a newer release is out, through the alerts inbox
 * rather than a dialog that blocks the app from opening.
 */

import { sendCoreAlert } from "../notify/core-notify.js";
import { getLocalVersion } from "../utils/app-version.js";
import { compareSemver, fetchLatestRelease } from "../utils/latest-release.js";
import { systemLogger } from "../utils/logger.js";
import {
  createCurrentUserPreferenceRepository,
  createCurrentUserRepository,
} from "../database/repositories/factory.js";

const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 60 * 1000;

let timer: NodeJS.Timeout | null = null;

/** Whether every local user turned the update check off. */
async function checkDisabled(): Promise<boolean> {
  const users = await createCurrentUserRepository().listAll();
  if (users.length === 0) return false;
  const preferences = createCurrentUserPreferenceRepository();
  for (const user of users) {
    const row = await preferences.findByUserId(user.id);
    if (!row?.disableUpdateCheck) return false;
  }
  return true;
}

export async function checkForDesktopUpdate(): Promise<void> {
  const current = getLocalVersion();
  if (!current || (await checkDisabled())) return;

  const latest = await fetchLatestRelease();
  if (!latest) return;
  const comparison = compareSemver(current, latest.version);
  if (comparison === null || comparison >= 0) return;

  await sendCoreAlert({
    title: `Termix ${latest.version} is available`,
    body: `You are on ${current}. Download the new version to update.`,
    severity: "info",
    category: "termix.update",
    dedupeKey: `update:${latest.version}`,
    audience: "admins",
    link: { url: latest.url },
    context: { value: latest.version },
  });
}

export function startDesktopUpdateCheck(): void {
  if (timer) return;
  const run = () =>
    void checkForDesktopUpdate().catch((error) => {
      systemLogger.warn("Update check failed", {
        operation: "desktop_update_check",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  setTimeout(run, FIRST_CHECK_MS).unref?.();
  timer = setInterval(run, CHECK_EVERY_MS);
  timer.unref?.();
}
