import type { IncomingMessage } from "node:http";
import type { Request } from "express";
import { isAllowedOrigin } from "./cors-config.js";

/**
 * WebSocket handshakes are not covered by CORS: the browser sends the request
 * (cookies included) and only the server can refuse it. Every socket here can
 * carry a live SSH/RDP/VNC session and authenticates off the `jwt` cookie, so
 * a foreign page that got the handshake through would own a terminal.
 *
 * `SameSite=Lax` on that cookie is the primary defense and already stops a
 * cross-site handshake from being authenticated; this is the second one, so a
 * single cookie-attribute regression is not the whole story.
 *
 * A missing Origin means a non-browser client (the native mobile app, a CLI,
 * an internal service call) - browsers always send it on a WebSocket
 * handshake - and is allowed, exactly as the HTTP CORS middleware does.
 */
export function isAllowedWebSocketOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  return isAllowedOrigin(origin, req as unknown as Request);
}

export function createWebSocketOriginVerifier() {
  return (
    info: { req: IncomingMessage },
    done: (result: boolean, code?: number, message?: string) => void,
  ): void => {
    if (isAllowedWebSocketOrigin(info.req)) return done(true);
    done(false, 403, "Forbidden origin");
  };
}
