// Mounted at /automations. Automations ships as a first-party in-process
// plugin (plugins/automations) rather than a route file imported directly
// here, so this module exists to keep /automations/* working at its original
// path without handing the plugin a reference to the shared app instance. The
// plugin runtime registers its router via registerAutomationsRouter when it
// activates, and clears it on deactivate, so a disabled plugin falls back to
// the 404 below.
//
// Unlike /plugin-api, this dispatcher applies no auth of its own: it forwards
// to exactly one first-party router (the Automations plugin's own), and every
// route in that router already applies authenticateJWT/requireDataAccess
// itself (including the intentionally unauthenticated webhook route, which
// gates on its own token instead), the same as every other router mounted
// alongside it here (/users, /host, /fleets, ...). /plugin-api gates at the
// mount point because it forwards to arbitrary third-party plugin code that
// cannot be assumed to gate itself; that reasoning does not apply to a single
// first-party router that already does.

import type { Request, Response, NextFunction, Router } from "express";
import { databaseLogger } from "../../utils/logger.js";

let activeRouter: Router | null = null;

export function registerAutomationsRouter(router: Router): void {
  activeRouter = router;
  databaseLogger.info("Registered Automations plugin router", {
    operation: "automations_dispatch_register",
  });
}

export function unregisterAutomationsRouter(): void {
  if (!activeRouter) return;
  activeRouter = null;
  databaseLogger.info("Unregistered Automations plugin router", {
    operation: "automations_dispatch_register",
  });
}

export default function automationsDispatch(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!activeRouter) {
    res.status(404).json({ error: "Automations is not available" });
    return;
  }
  activeRouter(req, res, next);
}
