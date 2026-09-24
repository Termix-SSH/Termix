/**
 * Who a plugin is acting as right now.
 *
 * Two ways a plugin gets an actor, and no third:
 *
 *   - A request. A4's HTTP and WebSocket middleware runs the handler inside
 *     runAsActor with the user core already authenticated, so a route handler
 *     acts as the person who called it.
 *   - ctx.asUser(userId, fn), for background work with no request behind it.
 *     That call is always audited.
 *
 * Nothing else. A plugin cannot pass a user id to a guarded ctx method and
 * have it believed, which is what stops the forged-caller class of bug the
 * worker broker had.
 *
 * AsyncLocalStorage rather than a module variable because plugin work
 * interleaves: two requests in flight would otherwise overwrite each other's
 * identity between awaits.
 */

import { AsyncLocalStorage } from "node:async_hooks";

interface ActorStore {
  userId: string;
  /** Where the identity came from, for the audit line. */
  source: "request" | "asUser" | "service";
  /** The session a request came in on, so core can spare it when revoking. */
  sessionId?: string;
}

const storage = new AsyncLocalStorage<ActorStore>();

export function runAsActor<T>(
  userId: string,
  source: ActorStore["source"],
  fn: () => T,
  sessionId?: string,
): T {
  return storage.run({ userId, source, sessionId }, fn);
}

export function getActorSessionId(): string | undefined {
  return storage.getStore()?.sessionId;
}

export function getActor(): string | undefined {
  return storage.getStore()?.userId;
}

export function getActorSource(): ActorStore["source"] | undefined {
  return storage.getStore()?.source;
}

export class PluginActorError extends Error {
  readonly code = "EPLUGINACTOR";

  constructor(pluginId: string, operation: string) {
    super(
      `Plugin "${pluginId}" called ${operation} with no acting user. ` +
        `Wrap background work in ctx.asUser(userId, fn).`,
    );
    this.name = "PluginActorError";
  }
}

export function requireActor(pluginId: string, operation: string): string {
  const userId = getActor();
  if (!userId) throw new PluginActorError(pluginId, operation);
  return userId;
}
