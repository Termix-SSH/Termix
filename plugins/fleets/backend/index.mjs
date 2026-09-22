/**
 * Fleets - first-party, in-process plugin.
 *
 * This plugin runs on the main thread rather than in a worker for the same
 * reason proxmox and ai do (see src/backend/plugins/first-party.ts): its
 * execute/transfer routes resolve and connect to many hosts concurrently over
 * the shared SSH pool via resolveHostById and withConnection, read/write
 * files over SFTP, and stream a zip archive back for pull requests. None of
 * that fits the worker ctx -- ctx.hosts is a 13-field read-only view with no
 * fleets surface at all, and ctx.http.route replies with a single postMessage
 * value rather than a stream.
 *
 * Like proxmox, this plugin does not own a live transport (no WebSocket
 * server, no dedicated port), so it registers its Express router with the
 * always-mounted /fleets dispatcher in
 * src/backend/database/routes/fleet-dispatch.ts instead of getting its own
 * port.
 *
 * routes.ts is what used to be src/backend/database/routes/fleet-routes.ts,
 * moved here and rewritten from `export default router` into
 * startFleetsService()/stopFleetsService(), called from
 * activate()/deactivate() below. The fleets/fleetMembers/fleetInventory
 * tables and their repositories stay in core (src/backend/database/db/schema.ts,
 * src/backend/database/repositories/fleet-repository.ts,
 * fleet-inventory-repository.ts) -- this plugin system has no owned-table
 * migration mechanism of its own, and these tables carry FKs into core's
 * hosts/users tables.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads a module by its path relative to this file's own directory.
 *
 * The plugin ships beside dist/backend, so in a built server the compiled
 * .js for routes.js sits right next to this .mjs, and core modules resolve
 * via ../../../backend/backend/... from there (dist/plugins/fleets/backend
 * -> dist/backend/backend). Under vitest/dev nothing imports this plugin
 * directly (the loader loads in-process plugins with a plain dynamic import,
 * no tsx loader involved), so the only layout that needs to resolve here is
 * the built one.
 */
async function loadRelative(relativePath) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = path.join(here, `${relativePath}.js`);
  return import(new URL(`file://${target.replace(/\\/g, "/")}`).href);
}

let routesModule = null;

export async function activate(ctx) {
  routesModule = await loadRelative("routes");
  routesModule.startFleetsService();
  ctx.log.info("Fleets router registered at /fleets");
}

export async function deactivate() {
  if (routesModule) {
    routesModule.stopFleetsService();
    routesModule = null;
  }
}
