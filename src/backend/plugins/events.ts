/**
 * The process-wide event bus behind ctx.events.
 *
 * This formalises three ad-hoc publish paths that already existed:
 *   - hosts/automation-events.ts  (generic named internal events)
 *   - hosts/metrics/automation-bridge.ts  (metrics-shaped siblings)
 *   - hosts/host-session-status.ts  (the "host.session.status" topic)
 *
 * Each of those lazily imported the automations engine and swallowed errors,
 * for two reasons that still apply and are preserved here:
 *
 *   1. Fire-and-forget. A failing subscriber must never disturb the caller. A
 *      metrics poll or a host delete does not fail because an automation threw.
 *   2. No static import of the automations layer. It reads repositories, which
 *      several hosts modules also pull in, so a static edge would close a
 *      cycle. Subscribers register themselves here instead of being reached
 *      into.
 *
 * Topics are dotted strings. The internal ones the server itself publishes are
 * listed in TOPICS; a plugin may emit and subscribe to any topic, but only
 * topics it is allowed to see are pushed to it.
 */

import { pluginLogger } from "../utils/logger.js";

export const TOPICS = {
  /** A terminal session opened or closed against a host. */
  hostSessionStatus: "host.session.status",
  /** A generic named internal event (host_deleted, user_login, ...). */
  internalEvent: "internal.event",
  /** A metrics snapshot for one host. */
  hostMetrics: "host.metrics",
  /** A host went online or offline as seen by the metrics poller. */
  hostStatus: "host.status",
  /** A health check result. */
  hostHealthCheck: "host.health_check",
  /** A host's connection details changed and pollers should re-read them. */
  hostUpdated: "host.updated",
  /** A host was deleted and any poller holding it should drop it. */
  hostDeleted: "host.deleted",
  /** Someone logged in over SSH to a host. */
  hostLogin: "host.login",
} as const;

export type EventListener = (payload: unknown) => void;

class PluginEventBus {
  private readonly listeners = new Map<string, Set<EventListener>>();

  on(topic: string, listener: EventListener): () => void {
    let set = this.listeners.get(topic);
    if (!set) {
      set = new Set();
      this.listeners.set(topic, set);
    }
    set.add(listener);

    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(topic);
    };
  }

  /**
   * Fire-and-forget by contract. Never throws, never returns a promise the
   * caller is expected to await, and one bad subscriber cannot stop the others.
   */
  emit(topic: string, payload: unknown): void {
    const set = this.listeners.get(topic);
    if (!set || set.size === 0) return;

    for (const listener of [...set]) {
      try {
        const result = listener(payload) as unknown;
        // A listener may be async; its rejection must not become unhandled.
        if (result && typeof (result as Promise<void>).catch === "function") {
          void (result as Promise<void>).catch((error) =>
            this.report(topic, error),
          );
        }
      } catch (error) {
        this.report(topic, error);
      }
    }
  }

  listenerCount(topic: string): number {
    return this.listeners.get(topic)?.size ?? 0;
  }

  /** Test seam. */
  clear(): void {
    this.listeners.clear();
  }

  private report(topic: string, error: unknown): void {
    pluginLogger.error(
      `Event listener for "${topic}" failed`,
      error instanceof Error ? error : new Error(String(error)),
      { operation: "plugin_events" },
    );
  }
}

export const pluginEvents = new PluginEventBus();
