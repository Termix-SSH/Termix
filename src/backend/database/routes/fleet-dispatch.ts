// Mounted at /fleets. Fleets ships as a first-party in-process plugin
// (plugins/fleets) rather than a route file imported directly here, so this
// module exists to keep /fleets/* working at its original path without
// handing the plugin a reference to the shared app instance. The plugin
// runtime registers its router via registerFleetsRouter when it activates,
// and clears it on deactivate, so a disabled plugin falls back to the 404
// below.
//
// Unlike /plugin-api, this dispatcher applies no auth of its own: it forwards
// to exactly one first-party router (the Fleets plugin's own), and every
// route in that router already applies authenticateJWT/requireDataAccess
// itself, the same as every other router mounted alongside it here (/users,
// /host, /snippets, ...). /plugin-api gates at the mount point because it
// forwards to arbitrary third-party plugin code that cannot be assumed to
// gate itself; that reasoning does not apply to a single first-party router
// that already does.

import type { Request, Response, NextFunction, Router } from "express";
import { databaseLogger } from "../../utils/logger.js";

let activeRouter: Router | null = null;

export function registerFleetsRouter(router: Router): void {
  activeRouter = router;
  databaseLogger.info("Registered Fleets plugin router", {
    operation: "fleets_dispatch_register",
  });
}

export function unregisterFleetsRouter(): void {
  if (!activeRouter) return;
  activeRouter = null;
  databaseLogger.info("Unregistered Fleets plugin router", {
    operation: "fleets_dispatch_register",
  });
}

export default function fleetsDispatch(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!activeRouter) {
    res.status(404).json({ error: "Fleets is not available" });
    return;
  }
  activeRouter(req, res, next);
}
