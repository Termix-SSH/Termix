/**
 * Declared events, separate from the plugin.* bus any plugin can read.
 *
 * Each event is kept in a capped timeline. A subscriber bound to a user only
 * hears about hosts that user can reach, checked at delivery. Events carry a
 * depth, so a rule that fires an action that fires the same rule stops.
 */

import { randomUUID } from "node:crypto";
import { MAX_EVENT_DEPTH } from "./constants.js";
import { getActorTrail, runAsActor } from "../plugins/actor.js";
import { PermissionManager } from "../utils/permission-manager.js";
import { pluginLogger } from "../utils/logger.js";
import { createCurrentOperationRepository } from "../database/repositories/factory.js";

export interface OperationEventInput {
  eventId: string;
  pluginId: string;
  hostId?: number;
  severity?: string;
  payload?: unknown;
  runId?: string;
  depth?: number;
}

export interface DeliveredEvent {
  id: string;
  eventId: string;
  pluginId: string;
  hostId?: number;
  severity?: string;
  payload?: unknown;
  runId?: string;
  depth: number;
  at: string;
}

export interface OperationEventSubscription {
  /** Exact id, `<pluginId>.*` or `*`. */
  pattern: string;
  handler: (event: DeliveredEvent) => void | Promise<void>;
  /** Only events for hosts this user can reach, and runs the handler as them. */
  userId?: string;
  /** Skips repeats of one event and host inside this window. */
  cooldownMs?: number;
}

interface Subscriber extends OperationEventSubscription {
  pluginId: string;
  lastFired: Map<string, number>;
}

const subscribers = new Set<Subscriber>();

function matches(pattern: string, eventId: string): boolean {
  if (pattern === "*" || pattern === eventId) return true;
  return pattern.endsWith(".*") && eventId.startsWith(pattern.slice(0, -1));
}

export function subscribeOperationEvents(
  pluginId: string,
  subscription: OperationEventSubscription,
): () => void {
  const entry = { ...subscription, pluginId, lastFired: new Map() };
  subscribers.add(entry);
  return () => {
    subscribers.delete(entry);
  };
}

async function deliver(subscriber: Subscriber, event: DeliveredEvent) {
  const key = `${event.eventId}|${event.hostId ?? ""}`;
  if (subscriber.cooldownMs) {
    const last = subscriber.lastFired.get(key) ?? 0;
    if (Date.now() - last < subscriber.cooldownMs) return;
    subscriber.lastFired.set(key, Date.now());
  }

  const { userId } = subscriber;
  if (userId && event.hostId !== undefined) {
    const access = await PermissionManager.getInstance().canAccessHost(
      userId,
      event.hostId,
      "connect",
    );
    if (!access.hasAccess) return;
  }

  const fire = () => Promise.resolve(subscriber.handler(event));
  await (userId
    ? runAsActor(userId, "service", fire, undefined, { depth: event.depth })
    : fire());
}

/** Never throws. An event must not be able to fail what caused it. */
export async function emitOperationEvent(
  input: OperationEventInput,
): Promise<void> {
  try {
    const trail = getActorTrail();
    const depth = input.depth ?? trail.depth ?? 0;
    const event: DeliveredEvent = {
      id: randomUUID(),
      eventId: input.eventId,
      pluginId: input.pluginId,
      hostId: input.hostId,
      severity: input.severity,
      payload: input.payload,
      runId: input.runId ?? trail.runId,
      depth,
      at: new Date().toISOString(),
    };

    await createCurrentOperationRepository().insertEvent({
      id: event.id,
      eventId: event.eventId,
      pluginId: event.pluginId,
      hostId: event.hostId ?? null,
      severity: event.severity ?? null,
      payload:
        event.payload === undefined ? null : JSON.stringify(event.payload),
      runId: event.runId ?? null,
      createdAt: event.at,
    });

    if (depth >= MAX_EVENT_DEPTH) {
      pluginLogger.warn("Event chain stopped at the depth limit", {
        operation: "operation_event_depth",
        eventId: event.eventId,
      });
      return;
    }

    for (const subscriber of subscribers) {
      if (!matches(subscriber.pattern, event.eventId)) continue;
      void deliver(subscriber, event).catch((error) => {
        pluginLogger.warn("Event subscriber failed", {
          operation: "operation_event_delivery",
          pluginId: subscriber.pluginId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  } catch (error) {
    pluginLogger.warn("Could not record an event", {
      operation: "operation_event",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Test seam. */
export function clearOperationEvents(): void {
  subscribers.clear();
}
