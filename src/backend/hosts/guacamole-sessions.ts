/**
 * What core needs from the Remote Desktop plugin, resolved through the plugin
 * registry rather than an import.
 *
 * collab, session-sharing and the admin guacd setting all need three things
 * from a running Guacamole server: mint a join token, look up a live session,
 * restart after a settings change. None of them can import the plugin -- core
 * cannot statically import something outside its rootDir -- and the plugin
 * cannot hand core a module reference without becoming core again.
 *
 * So the plugin publishes "remote-desktop.sessions" through ctx.registry on
 * activate, the registry revokes it on deactivate, and the helpers below
 * degrade the way each caller needs when nothing is published:
 *
 *   - a lookup returns null, because "no such live session" and "the plugin is
 *     off" mean the same thing to a caller asking whether a session is live;
 *   - a restart is a no-op, because resurrecting a server the plugin does not
 *     own would be worse than doing nothing;
 *   - minting a token throws, because a caller about to hand a viewer a join
 *     link needs to know it failed rather than get an unusable value.
 *
 * This replaces the guacamole-dispatch bridge that used to live in
 * database/routes/.
 */

import { consume } from "../plugins/registry.js";

export const GUACAMOLE_SESSIONS_KEY = "remote-desktop.sessions";

export interface GuacamoleSessionInfo {
  guacamoleConnectionId: string;
  hostId: number;
  ownerUserId: string;
  protocol: string;
  openedAt: number;
}

export interface GuacamoleSessionProvider {
  restart: () => Promise<void>;
  createJoinToken: (guacamoleConnectionId: string, readOnly: boolean) => string;
  getSessionInfo: (
    guacamoleConnectionId: string,
  ) => GuacamoleSessionInfo | null;
}

function provider(): GuacamoleSessionProvider | undefined {
  return consume<GuacamoleSessionProvider>(GUACAMOLE_SESSIONS_KEY);
}

/**
 * Restarts the plugin's guacd WebSocket server, e.g. after an admin edits the
 * guacd URL setting. A no-op while the plugin is disabled.
 */
export async function restartGuacamoleService(): Promise<void> {
  await provider()?.restart();
}

/**
 * Mints a read-only or writable join token for a live Guacamole session, for
 * collab and session-sharing to hand an invited viewer. Throws when the plugin
 * is not running.
 */
export function createGuacamoleJoinToken(
  guacamoleConnectionId: string,
  readOnly: boolean,
): string {
  const active = provider();
  if (!active) {
    throw new Error("Remote Desktop plugin is not available");
  }
  return active.createJoinToken(guacamoleConnectionId, readOnly);
}

/** Looks up a live Guacamole session by guacd's own connection id. */
export function getGuacamoleSessionInfo(
  guacamoleConnectionId: string,
): GuacamoleSessionInfo | null {
  return provider()?.getSessionInfo(guacamoleConnectionId) ?? null;
}
