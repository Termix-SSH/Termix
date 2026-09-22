/**
 * Tailscale - first-party, in-process plugin.
 *
 * This plugin runs on the main thread rather than in a worker for the same
 * reason fleets and proxmox do (see src/backend/plugins/first-party.ts): it
 * does not own a live transport of its own (no WebSocket server, no
 * dedicated port), so it registers its Express router with the
 * always-mounted /tailscale dispatcher in
 * src/backend/database/routes/tailscale-dispatch.ts instead of getting its
 * own port.
 *
 * routes.ts is what used to be src/backend/database/routes/tailscale-routes.ts,
 * moved here and rewritten from a direct app.use() call into
 * startTailscaleService()/stopTailscaleService(), called from
 * activate()/deactivate() below.
 *
 * tailscale-check.ts (SSH re-auth banner parsing) stays in core, at
 * src/backend/hosts/tailscale-check.ts, and is NOT part of this plugin.
 * It is imported directly by src/backend/hosts/terminal/index.ts (owned by
 * ssh-terminal), which type-checks under tsconfig.node.json's rootDir of
 * src/ -- a plugin .ts file physically outside that root cannot be a static
 * import target for core code (see scripts/copy-bundled-plugins.cjs's own
 * comment: plugin backends import core, never the reverse, anywhere in this
 * codebase). Moving the file into plugins/tailscale/backend/ would require
 * either widening tsconfig.node.json's rootDir for every other plugin's
 * dist path-rewriting, or switching terminal/index.ts to a dynamic import
 * inside its banner handler -- both bigger changes than this plugin
 * warrants. The banner/ready wiring and retry state already live in
 * ssh-terminal's connection handler regardless, so this stays exactly where
 * that coupling already lives.
 *
 * The /users/tailscale-settings GET/PATCH routes stay in core
 * (src/backend/database/routes/user-settings-routes.ts) -- they are general
 * user-settings infrastructure, not Tailscale-specific plumbing, and this
 * plugin's frontend calls them the same way core code does.
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
  routesModule.startTailscaleService();
  ctx.log.info("Tailscale router registered at /tailscale");
}

export async function deactivate() {
  if (routesModule) {
    routesModule.stopTailscaleService();
    routesModule = null;
  }
}
