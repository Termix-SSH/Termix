/**
 * One-line hand-off from any core feature to anything listening for a generic
 * named event (host_deleted, user_login, ...). Fire-and-forget: it publishes
 * onto the plugin event bus under "internal.event" and never waits on a
 * listener. Plugins subscribe through ctx.events.
 */

import { pluginEvents, TOPICS } from "../plugins/events.js";

export interface InternalEventPayload {
  event: string;
  userId: string;
  hostId?: number;
  details?: Record<string, unknown>;
}

export function emitInternalEvent(
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
