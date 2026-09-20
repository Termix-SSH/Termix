/**
 * One-line hand-off from any hosts feature to the automations engine for a
 * generic named event (not tied to metrics polling).
 *
 * Fire-and-forget and imported lazily: a failure in the automations layer
 * must never disturb the caller, and a static import would create a cycle
 * (automations reads repositories, which several hosts modules also pull in).
 *
 * PLUGIN-EVENT: this whole module is the "publish an internal event" half of
 * the phase-2 ctx.events bus. Once that exists, callers should emit onto
 * ctx.events instead of calling this directly, and the automations engine
 * subscribes there rather than being imported ad hoc.
 */

export function notifyAutomationInternalEvent(
  event: string,
  userId: string,
  hostId?: number,
  details?: Record<string, unknown>,
): void {
  if (!userId) return;
  import("../automations/triggers.js")
    .then((triggers) =>
      triggers.onInternalEvent({ event, userId, hostId, details }),
    )
    .catch(() => {});
}
