/**
 * One-line hand-off from the metrics poller to the automations engine.
 *
 * The poller is already a very large module, so the hooks it calls live here
 * instead. Everything is fire-and-forget and imported lazily: a failure in the
 * automations layer must never disturb metric collection, and a static import
 * would create a cycle (automations reads repositories, which the metrics
 * module also pulls in).
 *
 * For the generic (non-metrics) internal event notifier, see
 * `hosts/automation-events.ts` -- that one is shared across features.
 */

import type { MetricsSnapshot } from "../../automations/conditions.js";

export function notifyAutomationMetrics(
  hostId: number,
  ownerUserId: string,
  metrics: MetricsSnapshot,
): void {
  if (!ownerUserId) return;
  import("../../automations/triggers.js")
    .then((triggers) => triggers.onMetrics({ hostId, ownerUserId, metrics }))
    .catch(() => {});
}

export function notifyAutomationStatus(
  hostId: number,
  ownerUserId: string,
  online: boolean,
): void {
  if (!ownerUserId) return;
  import("../../automations/triggers.js")
    .then((triggers) => triggers.onStatus({ hostId, ownerUserId, online }))
    .catch(() => {});
}

export function notifyAutomationHealthCheck(
  hostId: number,
  userId: string,
  checkId: string,
  ok: boolean,
  detail?: string,
): void {
  if (!userId) return;
  import("../../automations/triggers.js")
    .then((triggers) =>
      triggers.onHealthCheck({ hostId, userId, checkId, ok, detail }),
    )
    .catch(() => {});
}
