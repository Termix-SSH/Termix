/**
 * The process-wide event bus behind ctx.events.
 *
 * Core publishes here (hosts/internal-events.ts for generic named events,
 * hosts/host-session-status.ts for "host.session.status", and the topics in
 * TOPICS below) and plugins subscribe through ctx.events. Two rules:
 *
 *   1. Fire-and-forget. A failing subscriber must never disturb the caller. A
 *      metrics poll or a host delete does not fail because a listener threw.
 *   2. No static import of a subscriber. Subscribers register themselves here
 *      instead of being reached into, so core never names a plugin.
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
  /** A host's status dot changed (hosts/status/host-status-service.ts). */
  hostStatus: "host.status",
  /** A host's key was accepted again after it changed. */
  hostKeyUpdated: "host.key.updated",
  /** A host's connection details changed and pollers should re-read them. */
  hostUpdated: "host.updated",
  /** A host was deleted and any poller holding it should drop it. */
  hostDeleted: "host.deleted",
  /** Someone logged in over SSH to a host. */
  hostLogin: "host.login",
  /**
   * A user's encrypted data was wiped because their DEK could not be
   * recovered on password reset. The user row itself survives, unlike
   * user.deleted, so a plugin with a refUser() cascade still needs this:
   * the row is not gone, only unrecoverable, and should go with it.
   */
  userDataWiped: "user.data_wiped",
  /**
   * A user account was deleted. For a plugin whose rows should outlive the
   * account (evidence, audit trail) rather than cascade with a refUser()
   * column: it keeps a plain userId column and anonymizes its own rows here,
   * the way core's own session recordings did before this event existed.
   */
  userDeleted: "user.deleted",
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
