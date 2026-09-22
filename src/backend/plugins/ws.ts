/**
 * WebSockets for plugins: one upgrade handler, no ports.
 *
 * A plugin registers /plugin-ws/<id>/<path> and core serves it from the main
 * server's upgrade event. Auth is the same as every other socket in Termix
 * (utils/ws-auth.ts), the actor is set for the handler, and every socket a
 * plugin opened is closed when it deactivates.
 *
 * Two shapes, because two kinds of caller exist:
 *
 *   - route(): core owns the WebSocketServer and hands the plugin a live
 *     socket. What a plugin writing its own protocol wants.
 *   - upgrade(): core hands over the raw upgrade after authenticating it, for
 *     a library that insists on owning its own server. guacamole-lite is the
 *     reason this exists: it constructs a WebSocketServer internally, so the
 *     only way to attach it is to give it the upgrade.
 *
 * Both run auth first, so "bring your own server" never means "bring your own
 * auth".
 */

import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  PluginWebSocketHandler,
  PluginWebSocketOptions,
} from "@termix/plugin-sdk/backend";
import { pluginLogger } from "../utils/logger.js";
import { extractWebSocketToken } from "../utils/ws-auth.js";
import { runAsActor } from "./actor.js";

export const PLUGIN_WS_PREFIX = "/plugin-ws/";

type RawUpgradeHandler = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  userId: string,
) => void;

interface Route {
  pluginId: string;
  path: string;
  options: PluginWebSocketOptions;
  /** Declared capabilities, for the per-upgrade network:serve check. */
  declared: readonly string[];
  handler?: PluginWebSocketHandler;
  rawHandler?: RawUpgradeHandler;
}

/** Keyed by "<pluginId>:<path>". */
const routes = new Map<string, Route>();

/** One server per plugin route, so disposal can close exactly its sockets. */
const servers = new Map<string, WebSocketServer>();

const attachedServers = new Set<HttpServer>();

function normalizePath(path: string): string {
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.length > 1 && withSlash.endsWith("/")
    ? withSlash.slice(0, -1)
    : withSlash;
}

function key(pluginId: string, path: string): string {
  return `${pluginId}:${normalizePath(path)}`;
}

/**
 * Parses /plugin-ws/<id>/<path> out of an upgrade URL.
 *
 * Returns null for anything else, so core's own sockets and a stray request
 * both fall through to whatever else is listening rather than being claimed.
 */
export function parsePluginWsUrl(
  url: string | undefined,
): { pluginId: string; path: string } | null {
  if (!url) return null;
  const pathname = url.split("?")[0];
  if (!pathname.startsWith(PLUGIN_WS_PREFIX)) return null;

  const rest = pathname.slice(PLUGIN_WS_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;

  const pluginId = rest.slice(0, slash);
  const path = normalizePath(rest.slice(slash));
  if (!pluginId || path === "/") return null;
  return { pluginId, path };
}

/**
 * Resolves the user behind an upgrade, or null.
 *
 * A half-authenticated session is not a user: a token still awaiting TOTP is
 * refused here exactly as createAuthMiddleware refuses it for HTTP, so a
 * socket cannot be the way around the second factor.
 */
async function verifyToken(request: IncomingMessage): Promise<string | null> {
  const token = extractWebSocketToken(request);
  if (!token) return null;
  try {
    const { AuthManager } = await import("../utils/auth-manager.js");
    const payload = await AuthManager.getInstance().verifyJWTToken(token);
    if (!payload || payload.pendingTOTP) return null;
    return payload.userId ?? null;
  } catch {
    return null;
  }
}

function reject(socket: Duplex, status: number, message: string): void {
  try {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  } catch {
    // The peer may already be gone.
  }
  socket.destroy();
}

/**
 * Serves a plugin upgrade, or returns false so the caller can pass it on.
 *
 * Exported for the test suite and for database.ts, which wires it into both
 * the HTTP and the HTTPS server.
 */
export async function handlePluginUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): Promise<boolean> {
  const parsed = parsePluginWsUrl(request.url);
  if (!parsed) return false;

  const route = routes.get(key(parsed.pluginId, parsed.path));
  if (!route) {
    // Claimed by the prefix but nothing is listening: answering here is more
    // honest than leaving the socket hanging for a plugin that is disabled.
    reject(socket, 404, "Not Found");
    return true;
  }

  // Same reasoning as the HTTP side: the grant is in the database, so it is
  // checked per upgrade rather than at registration, and a revoke takes effect
  // on the next connection without a restart.
  const { hasCapability } = await import("./permissions.js");
  if (!(await hasCapability(route.pluginId, "network:serve", route.declared))) {
    reject(socket, 403, "Forbidden");
    return true;
  }

  let userId = "";
  if (!route.options.public) {
    const resolved = await verifyToken(request);
    if (!resolved) {
      reject(socket, 401, "Unauthorized");
      return true;
    }
    userId = resolved;
  }

  if (route.rawHandler) {
    const rawHandler = route.rawHandler;
    runAsActor(userId || "anonymous", "request", () =>
      rawHandler(request, socket, head, userId),
    );
    return true;
  }

  const server = servers.get(key(route.pluginId, route.path));
  if (!server) {
    reject(socket, 503, "Service Unavailable");
    return true;
  }

  server.handleUpgrade(request, socket, head, (ws: WebSocket) => {
    const handler = route.handler;
    if (!handler) {
      ws.close(1011, "No handler");
      return;
    }
    runAsActor(userId || "anonymous", "request", () => {
      void Promise.resolve(handler({ userId, request, socket: ws })).catch(
        (error) => {
          pluginLogger.error(
            `Plugin ${route.pluginId} socket ${route.path} failed`,
            error instanceof Error ? error : new Error(String(error)),
            { operation: "plugin_ws_error" },
          );
          try {
            ws.close(1011, "Plugin error");
          } catch {
            // Already closed.
          }
        },
      );
    });
  });

  return true;
}

/** Wires the upgrade handler onto a server. Idempotent per server. */
export function attachPluginWebSockets(server: HttpServer): void {
  if (attachedServers.has(server)) return;
  attachedServers.add(server);

  server.on("upgrade", (request, socket, head) => {
    void handlePluginUpgrade(
      request as IncomingMessage,
      socket as Duplex,
      head as Buffer,
    ).catch((error) => {
      pluginLogger.error(
        "Plugin WebSocket upgrade failed",
        error instanceof Error ? error : new Error(String(error)),
        { operation: "plugin_ws_upgrade" },
      );
      reject(socket as Duplex, 500, "Internal Server Error");
    });
  });
}

export function registerPluginWsRoute(
  pluginId: string,
  path: string,
  handler: PluginWebSocketHandler,
  declared: readonly string[],
  options: PluginWebSocketOptions = {},
): () => void {
  const routeKey = key(pluginId, path);
  const normalized = normalizePath(path);

  routes.set(routeKey, {
    pluginId,
    path: normalized,
    options,
    declared,
    handler,
  });
  servers.set(routeKey, new WebSocketServer({ noServer: true }));

  pluginLogger.info(`Mounted /plugin-ws/${pluginId}${normalized}`, {
    operation: "plugin_ws_mount",
  });

  return () => disposeRoute(routeKey, pluginId, normalized);
}

export function registerPluginWsUpgrade(
  pluginId: string,
  path: string,
  handler: RawUpgradeHandler,
  declared: readonly string[],
  options: PluginWebSocketOptions = {},
): () => void {
  const routeKey = key(pluginId, path);
  const normalized = normalizePath(path);

  routes.set(routeKey, {
    pluginId,
    path: normalized,
    options,
    declared,
    rawHandler: handler,
  });

  pluginLogger.info(`Mounted raw upgrade /plugin-ws/${pluginId}${normalized}`, {
    operation: "plugin_ws_mount",
  });

  return () => disposeRoute(routeKey, pluginId, normalized);
}

function disposeRoute(routeKey: string, pluginId: string, path: string): void {
  routes.delete(routeKey);

  const server = servers.get(routeKey);
  if (server) {
    servers.delete(routeKey);
    // Close the clients first: server.close() waits for them to drain, and a
    // live terminal would otherwise keep the route alive after deactivate.
    for (const client of server.clients) {
      try {
        client.close(1001, "Plugin disabled");
      } catch {
        // Already gone.
      }
    }
    try {
      server.close();
    } catch {
      // Closing twice is not an error worth surfacing.
    }
  }

  pluginLogger.info(`Unmounted /plugin-ws/${pluginId}${path}`, {
    operation: "plugin_ws_unmount",
  });
}

export function getRegisteredWsRoutes(): string[] {
  return [...routes.keys()];
}

/** Test seam. */
export function resetPluginWebSockets(): void {
  for (const routeKey of [...routes.keys()]) {
    const route = routes.get(routeKey);
    if (route) disposeRoute(routeKey, route.pluginId, route.path);
  }
  routes.clear();
  servers.clear();
  attachedServers.clear();
}
