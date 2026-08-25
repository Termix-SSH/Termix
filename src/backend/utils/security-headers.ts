import type { Request, Response, NextFunction } from "express";

/**
 * `frame-ancestors` is the only CSP directive that cannot be delivered through
 * a meta tag, and it is the one that matters most here: a framed Termix means
 * a framed live SSH terminal. It defaults to `'self'` and is widened through
 * FRAME_ANCESTORS for people who embed Termix in a dashboard.
 *
 * Deliberately no other CSP directive: the responses this middleware covers
 * range from JSON to the server-rendered OPKSSH pages, and a blanket
 * `default-src` would break them without buying anything the same-origin
 * policy does not already provide.
 */
function frameAncestors(): string {
  return process.env.FRAME_ANCESTORS?.trim() || "'self'";
}

export function createSecurityHeadersMiddleware() {
  return (_req: Request, res: Response, next: NextFunction) => {
    // nginx sets this for the static document, but every proxied API response
    // arrives without it because a location-level add_header replaces the
    // server-level one.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Content-Security-Policy",
      `frame-ancestors ${frameAncestors()}`,
    );
    next();
  };
}
