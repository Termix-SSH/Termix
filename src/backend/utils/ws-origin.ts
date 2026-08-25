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
    // ws calls this synchronously from the upgrade handler, where a thrown
    // error is an uncaught exception rather than a failed handshake - so a
    // malformed header on one connection would take the whole process down.
    // Refuse on error: a rejected handshake is recoverable, a crash is not.
    let allowed: boolean;
    try {
      allowed = isAllowedWebSocketOrigin(info.req);
    } catch {
      allowed = false;
    }

    if (allowed) return done(true);
    done(false, 403, "Forbidden origin");
  };
}
