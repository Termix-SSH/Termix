/**
 * Workspaces - first-party, in-process plugin.
 *
 * Unlike the other first-party plugins (see src/backend/plugins/first-party.ts),
 * this one does not own a transport or touch the shared SSH pool -- its routes
 * are plain per-user JSON CRUD against a single repository. It runs in-process
 * anyway to keep its existing /workspaces URL and its existing dedicated table
 * (user_workspaces, keyed by userId) rather than moving onto
 * /plugin-api/workspaces/* and the generic key-value ctx.storage the worker
 * tier would require, matching how network-topology was migrated in place
 * rather than reworked around the worker ctx boundary.
 *
 * Like network-topology, this plugin does not get its own port -- it
 * registers its Express router with the always-mounted /workspaces
 * dispatcher in src/backend/database/routes/workspace-dispatch.ts.
 *
 * routes.ts is what used to be src/backend/database/routes/workspaces.ts,
 * moved here and rewritten from `export default router` into
 * startWorkspacesService()/stopWorkspacesService(), called from
 * activate()/deactivate() below. The user_workspaces table and its
 * repository stay in core (src/backend/database/db/schema.ts,
 * src/backend/database/repositories/workspace-repository.ts) -- this
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
  routesModule.startWorkspacesService();
  ctx.log.info("Workspaces router registered at /workspaces");
}

export async function deactivate() {
  if (routesModule) {
    routesModule.stopWorkspacesService();
    routesModule = null;
  }
}
