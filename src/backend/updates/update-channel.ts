/**
 * Which Termix releases this instance hears about. The server can't swap its
 * own image or installer, so the channel only steers update checks and the
 * Updates page. A beta build always counts as beta.
 */

import { createCurrentSettingsRepository } from "../database/repositories/factory.js";
import { getLocalVersion } from "../utils/app-version.js";
import {
  isPrereleaseVersion,
  type UpdateChannel,
} from "../utils/latest-release.js";

export const CORE_CHANNEL_KEY = "core_update_channel";

export function parseChannel(value: unknown): UpdateChannel | null {
  return value === "stable" || value === "beta" ? value : null;
}

export async function getStoredCoreChannel(): Promise<UpdateChannel> {
  const stored = await createCurrentSettingsRepository().get(CORE_CHANNEL_KEY);
  return parseChannel(stored) ?? "stable";
}

export async function getCoreChannel(
  localVersion: string | null = getLocalVersion(),
): Promise<UpdateChannel> {
  if (localVersion && isPrereleaseVersion(localVersion)) return "beta";
  return getStoredCoreChannel();
}

export async function setCoreChannel(channel: UpdateChannel): Promise<void> {
  await createCurrentSettingsRepository().set(CORE_CHANNEL_KEY, channel);
}
