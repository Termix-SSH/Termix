/**
 * Network Topology - first-party, in-process plugin.
 *
 * Unlike the other first-party plugins (see src/backend/plugins/first-party.ts),
 * this one does not own a transport or touch the shared SSH pool -- its two
 * routes are plain per-user JSON CRUD against a single repository. It runs
 * in-process anyway to keep its existing /network-topology URL and its
 * existing dedicated table (network_topology, keyed by userId) rather than
 * moving onto /plugin-api/network-topology/* and the generic key-value
 * ctx.storage the worker tier would require, matching how fleets/proxmox/
 * automations were migrated in place rather than reworked around the worker
 * ctx boundary.
 *
 * Like fleets and proxmox, this plugin does not get its own port -- it
 * registers its Express router with the always-mounted /network-topology
 * dispatcher in src/backend/database/routes/network-topology-dispatch.ts.
 *
 * routes.ts is what used to be
 * src/backend/database/routes/network-topology.ts, moved here and rewritten
 * from `export default router` into
 * startNetworkTopologyService()/stopNetworkTopologyService(), called from
 * activate()/deactivate() below. The network_topology table and its
 * repository stay in core (src/backend/database/db/schema.ts,
 * src/backend/database/repositories/network-topology-repository.ts) -- this
 * plugin system has no owned-table migration mechanism of its own, and the
 * table carries an FK into core's users table.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads a module by its path relative to this file's own directory.
 *
 * The plugin ships beside dist/backend, so in a built server the compiled
 * .js for routes.js sits right next to this .mjs. Under vitest/dev nothing
 * imports this plugin directly (the loader loads in-process plugins with a
 * plain dynamic import, no tsx loader involved), so the only layout that
 * needs to resolve here is the built one.
 */
async function loadRelative(relativePath) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = path.join(here, `${relativePath}.js`);
  return import(new URL(`file://${target.replace(/\\/g, "/")}`).href);
}

let routesModule = null;

export async function activate(ctx) {
  routesModule = await loadRelative("routes");
  routesModule.startNetworkTopologyService();
  ctx.log.info("Network Topology router registered at /network-topology");
}

export async function deactivate() {
  if (routesModule) {
    routesModule.stopNetworkTopologyService();
    routesModule = null;
  }
}
