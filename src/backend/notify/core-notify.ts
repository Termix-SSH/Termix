/**
 * Alerts core itself sends (an update is out, a desktop lost its link),
 * through whichever plugin serves as the alert hub. With no hub running they
 * reach nobody, same as a plugin's.
 */

import type { PluginNotification } from "@termix/plugin-sdk/backend";
import { activeNotifyHub } from "../plugins/notify-hub.js";
import { resolveAudience } from "../plugins/ctx-notify.js";
import { systemLogger } from "../utils/logger.js";

/** Shown as the sender of core's alerts. */
export const CORE_ALERT_SOURCE = "termix";

export async function sendCoreAlert(
  notification: PluginNotification & {
    audience: NonNullable<PluginNotification["audience"]>;
  },
): Promise<void> {
  try {
    const hub = await activeNotifyHub();
    if (!hub) return;
    const recipients = await resolveAudience(notification.audience);
    if (recipients.length === 0) return;
    await hub.deliver({ source: CORE_ALERT_SOURCE, recipients, notification });
  } catch (error) {
    systemLogger.warn("Could not send an alert", {
      operation: "core_alert",
      category: notification.category,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
