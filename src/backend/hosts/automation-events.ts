/**
 * One-line hand-off from any hosts feature to anything listening for a generic
 * named event (not tied to metrics polling).
 *
 * This now publishes onto the ctx.events bus rather than reaching into the
 * automations engine directly. The two properties callers relied on are
 * unchanged: it is fire-and-forget, and it creates no static edge to the
 * automations layer (which reads repositories that several hosts modules also
 * pull in, so a static import would close a cycle). The automations engine
 * subscribes to the bus at start-up instead -- see automations/triggers.ts.
 */

import { pluginEvents, TOPICS } from "../plugins/events.js";

export interface InternalEventPayload {
  event: string;
  userId: string;
  hostId?: number;
  details?: Record<string, unknown>;
}

export function notifyAutomationInternalEvent(
  event: string,
  userId: string,
  hostId?: number,
  details?: Record<string, unknown>,
): void {
  if (!userId) return;
  pluginEvents.emit(TOPICS.internalEvent, {
    event,
    userId,
    hostId,
    details,
  } satisfies InternalEventPayload);
}
