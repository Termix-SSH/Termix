/**
 * Proxmox discovery/import/sync - first-party, in-process plugin.
 *
 * This plugin runs on the main thread rather than in a worker for the same
 * reason ai does (see src/backend/plugins/first-party.ts): it writes
 * directly across hosts through the host repository, resolves and connects
 * to hosts over the shared SSH pool via resolveHostById and
 * createJumpHostChain, verifies host keys via SSHHostKeyVerifier, and
 * streams its discovery progress as server-sent events. None of that fits
 * the worker ctx -- ctx.hosts is a 13-field read-only view with no write
 * methods, and ctx.http.route replies with a single postMessage value
 * rather than a stream.
 *
 * Like ai, this plugin does not own a live transport (no WebSocket server,
 * no dedicated port), so it registers its Express router with the
 * always-mounted /proxmox dispatcher in
 * src/backend/database/routes/proxmox-dispatch.ts instead of getting its
 * own port.
 *
 * routes.ts is what used to be src/backend/database/routes/proxmox.ts,
 * moved here with its sibling modules (proxmox-import-auth.ts,
 * proxmox-jump-hosts.ts) and rewritten from `export default router` into
 * startProxmoxService()/stopProxmoxService(), called from
 * activate()/deactivate() below. Those two functions also start and stop
 * the background auto-sync interval that used to run at module scope in
 * proxmox.ts -- keeping it there would mean it fires even when this plugin
 * is disabled and can never be torn down.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads a module by its path relative to this file's own directory.
 *
 * The plugin ships beside dist/backend, so in a built server the compiled
 * .js for the moved Proxmox files (routes.js, ...) sits right next to this
 * .mjs, and core modules resolve via ../../../backend/backend/... from
 * there (dist/plugins/proxmox/backend -> dist/backend/backend). Under
 * vitest/dev nothing imports this plugin directly (the loader loads
 * in-process plugins with a plain dynamic import, no tsx loader involved),
 * so the only layout that needs to resolve here is the built one.
 */
async function loadRelative(relativePath) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = path.join(here, `${relativePath}.js`);
  return import(new URL(`file://${target.replace(/\\/g, "/")}`).href);
}

let routesModule = null;

export async function activate(ctx) {
  routesModule = await loadRelative("routes");
  routesModule.startProxmoxService();
  ctx.log.info("Proxmox router registered at /proxmox");
}

export async function deactivate() {
  if (routesModule) {
    routesModule.stopProxmoxService();
    routesModule = null;
  }
}
