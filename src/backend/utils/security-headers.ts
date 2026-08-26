import type { Request, Response, NextFunction } from "express";

/**
 * `frame-ancestors` is the only CSP directive that cannot be delivered through
 * a meta tag, and it is the one that matters most here: a framed Termix means
 * a framed live SSH terminal.
 *
 * It is opt-in rather than on by default, because the desktop app signs in
 * against a remote server by rendering that server inside an <iframe> from a
 * file:// document (see ElectronLoginForm). A default of 'self' would refuse
 * that ancestor and break the remote login. Whether Chromium inside Electron
 * reports the ancestor as `file:` or as an opaque origin could not be
 * established here, so widening the default was not a safe answer either.
 *
 * Set FRAME_ANCESTORS to turn the protection on -- "'self'" for the common
 * case, or "'self' https://dash.example.com" to embed Termix elsewhere.
 *
 * Deliberately no other CSP directive: the responses this middleware covers
 * range from JSON to the server-rendered OPKSSH pages, and a blanket
 * `default-src` would break them without buying anything the same-origin
 * policy does not already provide.
 */
function frameAncestors(): string | undefined {
  const configured = process.env.FRAME_ANCESTORS?.trim();
  return configured || undefined;
}

export function createSecurityHeadersMiddleware() {
  return (_req: Request, res: Response, next: NextFunction) => {
    // nginx sets this for the static document, but every proxied API response
    // arrives without it because a location-level add_header replaces the
    // server-level one.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    const ancestors = frameAncestors();
    if (ancestors) {
      res.setHeader("Content-Security-Policy", `frame-ancestors ${ancestors}`);
    }

    next();
  };
}
