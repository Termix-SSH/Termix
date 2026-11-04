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

/** How a call reached core, for run history and approval rules. */
export interface ActorOrigin {
  kind: "ui" | "api" | "plugin";
  /** Which plugin asked, set by core from the ctx that made the call. */
  pluginId?: string;
  /** What the plugin was doing: automation, assistant, mcp, rollout and so on. */
  via?: string;
}

/** Follows a call through plugin work, so nothing loses who started it. */
export interface ActorTrail {
  origin?: ActorOrigin;
  apiKeyId?: string;
  /** Null means a key with full access. */
  apiKeyScopes?: string[] | null;
  /** The operation run this work belongs to. */
  runId?: string;
  /** How many operations or events led here. */
  depth?: number;
}

interface ActorStore extends ActorTrail {
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
  trail?: ActorTrail,
): T {
  const parent = storage.getStore();
  return storage.run(
    {
      origin: parent?.origin,
      apiKeyId: parent?.apiKeyId,
      apiKeyScopes: parent?.apiKeyScopes,
      runId: parent?.runId,
      depth: parent?.depth,
      ...trail,
      userId,
      source,
      sessionId,
    },
    fn,
  );
}

export function getActorTrail(): ActorTrail {
  const store = storage.getStore();
  return {
    origin: store?.origin,
    apiKeyId: store?.apiKeyId,
    apiKeyScopes: store?.apiKeyScopes,
    runId: store?.runId,
    depth: store?.depth,
  };
}

export function getActorSessionId(): string | undefined {
  return storage.getStore()?.sessionId;
}

export function getActor(): string | undefined {
  return storage.getStore()?.userId;
}
