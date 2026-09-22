// Mounted at /guacamole. Remote Desktop ships as a first-party in-process
// plugin (plugins/remote-desktop) rather than a route file imported directly
// here, so this module keeps /guacamole/* working at its original path
// without handing the plugin a reference to the shared app instance.
//
// It also brokers the small surface collab, session-sharing and the admin
// settings route need from the plugin (join tokens, live-session lookups, a
// server restart hook). Those core modules cannot import the plugin's
// TypeScript directly -- plugins/ is compiled by tsconfig.plugins.json as a
// one-directional read of src/backend/ (see copy-bundled-plugins.cjs), and a
// core file under tsconfig.node.json's rootDir cannot statically import
// something outside it. So the plugin registers this bridge once on
// activate, and clears it on deactivate; a disabled/uninstalled plugin falls
// back to the safe defaults below (404 for the router, null for session
// lookups, a no-op restart).
//
// This is an accepted, temporary coupling -- see the plugin's own README.
// collab and session-sharing are expected to become plugins of their own
// later, at which point this becomes a real inter-plugin service reference
// instead of a bridge object living in core.
//
// The router forwards with no auth of its own: it delegates to exactly one
// first-party router, and every route in that router already applies its
// own auth middleware.

import type { Request, Response, NextFunction, Router } from "express";
import { databaseLogger } from "../../utils/logger.js";

export interface GuacamoleSessionInfo {
  guacamoleConnectionId: string;
  hostId: number;
  ownerUserId: string;
  protocol: string;
  openedAt: number;
}

export interface GuacamoleBridge {
  router: Router;
  restart: () => Promise<void>;
  createJoinToken: (guacamoleConnectionId: string, readOnly: boolean) => string;
  getSessionInfo: (
    guacamoleConnectionId: string,
  ) => GuacamoleSessionInfo | null;
}

let bridge: GuacamoleBridge | null = null;

export function registerGuacamoleBridge(next: GuacamoleBridge): void {
  bridge = next;
  databaseLogger.info("Registered Remote Desktop plugin bridge", {
    operation: "guacamole_dispatch_register",
  });
}

export function unregisterGuacamoleBridge(): void {
  if (!bridge) return;
  bridge = null;
  databaseLogger.info("Unregistered Remote Desktop plugin bridge", {
    operation: "guacamole_dispatch_register",
  });
}

/**
 * Restarts the plugin's guacd WebSocket server, e.g. after an admin edits
 * the guacd URL setting (see user-settings-routes.ts). A no-op while the
 * plugin is disabled/uninstalled -- restarting a server that does not exist
 * would otherwise silently resurrect it outside the plugin lifecycle.
 */
export async function restartGuacamoleService(): Promise<void> {
  if (!bridge) return;
  await bridge.restart();
}

/**
 * Mints a read-only/writable join token for an existing live Guacamole
 * session, for collab/session-sharing to hand to an invited viewer. Throws
 * when the plugin is disabled/uninstalled -- unlike the read-only lookups
 * below, a caller asking to mint a join token needs to know it failed rather
 * than silently getting an unusable value.
 */
export function createGuacamoleJoinToken(
  guacamoleConnectionId: string,
  readOnly: boolean,
): string {
  if (!bridge) {
    throw new Error("Remote Desktop plugin is not available");
  }
  return bridge.createJoinToken(guacamoleConnectionId, readOnly);
}

/**
 * Looks up a live Guacamole session by guacd's own connection id. Returns
 * null both when no such session exists and when the plugin is
 * disabled/uninstalled -- to a caller checking "is this session live", the
 * two cases mean the same thing.
 */
export function getGuacamoleSessionInfo(
  guacamoleConnectionId: string,
): GuacamoleSessionInfo | null {
  return bridge?.getSessionInfo(guacamoleConnectionId) ?? null;
}

export default function guacamoleDispatch(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!bridge) {
    res.status(404).json({ error: "Remote Desktop is not available" });
    return;
  }
  bridge.router(req, res, next);
}
