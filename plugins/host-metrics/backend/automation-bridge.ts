/**
 * One-line hand-off from the metrics poller onto the ctx.events bus.
 *
 * The poller is already a very large module, so the hooks it calls live here
 * instead. Everything is fire-and-forget: a failure in a subscriber must never
 * disturb metric collection, and publishing onto the bus creates no static edge
 * to the automations layer (which reads repositories the metrics module also
 * pulls in).
 *
 * For the generic (non-metrics) internal event notifier, see
 * `hosts/automation-events.ts` -- that one is shared across features.
 */

import { pluginEvents, TOPICS } from "../../../src/backend/plugins/events.js";
import type { MetricsSnapshot } from "../../automations/backend/conditions.js";

export interface HostMetricsPayload {
  hostId: number;
  ownerUserId: string;
  metrics: MetricsSnapshot;
}

export interface HostStatusPayload {
  hostId: number;
  ownerUserId: string;
  online: boolean;
}

export interface HostHealthCheckPayload {
  hostId: number;
  userId: string;
  checkId: string;
  ok: boolean;
  detail?: string;
}

export function notifyAutomationMetrics(
  hostId: number,
  ownerUserId: string,
  metrics: MetricsSnapshot,
): void {
  if (!ownerUserId) return;
  pluginEvents.emit(TOPICS.hostMetrics, {
    hostId,
    ownerUserId,
    metrics,
  } satisfies HostMetricsPayload);
}

export function notifyAutomationStatus(
  hostId: number,
  ownerUserId: string,
  online: boolean,
): void {
  if (!ownerUserId) return;
  pluginEvents.emit(TOPICS.hostStatus, {
    hostId,
    ownerUserId,
    online,
  } satisfies HostStatusPayload);
}

export function notifyAutomationHealthCheck(
  hostId: number,
  userId: string,
  checkId: string,
  ok: boolean,
  detail?: string,
): void {
  if (!userId) return;
  pluginEvents.emit(TOPICS.hostHealthCheck, {
    hostId,
    userId,
    checkId,
    ok,
    detail,
  } satisfies HostHealthCheckPayload);
}
