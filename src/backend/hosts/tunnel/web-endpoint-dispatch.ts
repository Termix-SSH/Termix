// Mounted at /ssh/tunnel/web-endpoint on the tunnel service's app. Web
// Endpoint ships as a first-party in-process plugin (plugins/web-endpoint)
// rather than a route file imported directly by index.ts, so this module
// exists to keep /ssh/tunnel/web-endpoint/* working at its original path
// without handing the plugin a reference to the shared app instance. The
// plugin runtime registers its router via registerWebEndpointRouter when it
// activates, and clears it on deactivate, so a disabled plugin falls back to
// the 404 below.
//
// This is the only dispatcher that lives outside database.ts: the route is
// served by the tunnel service on port 30003, and nginx already proxies the
// whole /ssh/tunnel/ prefix there. Both that service and the plugin runtime
// are loaded into the same backend process (starter.ts imports
// hosts/tunnel/index.js), so the module-level slot below is shared state
// between them, exactly as it is for the dispatchers in database.ts.
//
// Unlike /plugin-api, this dispatcher applies no auth of its own: it forwards
// to exactly one first-party router (the Web Endpoint plugin's own), and every
// route in that router already applies authenticateJWT itself, the same as
// every other route registered alongside it here. /plugin-api gates at the
// mount point because it forwards to arbitrary third-party plugin code that
// cannot be assumed to gate itself; that reasoning does not apply to a single
// first-party router that already does.

import type { Request, Response, NextFunction, Router } from "express";
import { tunnelLogger } from "../../utils/logger.js";

let activeRouter: Router | null = null;

export function registerWebEndpointRouter(router: Router): void {
  activeRouter = router;
  tunnelLogger.info("Registered Web Endpoint plugin router", {
    operation: "web_endpoint_dispatch_register",
  });
}

export function unregisterWebEndpointRouter(): void {
  if (!activeRouter) return;
  activeRouter = null;
  tunnelLogger.info("Unregistered Web Endpoint plugin router", {
    operation: "web_endpoint_dispatch_register",
  });
}

export default function webEndpointDispatch(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!activeRouter) {
    res.status(404).json({ error: "Web endpoints are not available" });
    return;
  }
  activeRouter(req, res, next);
}
