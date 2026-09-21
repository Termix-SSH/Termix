/**
 * Host Metrics - first-party, in-process plugin.
 *
 * This plugin runs on the main thread rather than in a worker for the same
 * reason ssh-terminal and docker do (see src/backend/plugins/first-party.ts):
 * its polling manager holds long-lived ssh2.Client connections across a
 * whole fleet of hosts, reused between polling ticks, and its connect flow
 * implements the same jump-host/SOCKS5/TOTP/Warpgate/OPKSSH/Vault
 * keyboard-interactive handshakes the terminal does. None of that can cross
 * the structured-clone postMessage boundary a worker plugin talks over, and
 * the worker ctx.ssh primitive (connect + single exec-and-collect) has no
 * hook for a session that outlives one request.
 *
 * routes.ts is what used to be src/backend/hosts/metrics/index.ts, moved
 * here and rewritten from a module-scope SIGINT/SIGTERM + listenOnServicePort
 * call into startHostMetricsService()/shutdown(), called from
 * activate()/deactivate() below.
 *
 * Proxmox-related code (metrics/proxmox/*, proxmox-stats-*) stays in core at
 * src/backend/hosts/metrics/ rather than moving here -- it is planned as its
 * own future plugin, so this move does not touch it.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads a module by its path relative to this file's own directory.
 *
 * The plugin ships beside dist/backend, so in a built server the compiled
 * .js for the moved host-metrics files (routes.js, ...) sits right next to
 * this .mjs, and core modules resolve via ../../../backend/backend/... from
 * there (dist/plugins/host-metrics/backend -> dist/backend/backend). Under
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
let httpServer = null;

export async function activate(ctx) {
  routesModule = await loadRelative("routes");

  httpServer = routesModule.startHostMetricsService();

  ctx.log.info(`Host Metrics listening on ${routesModule.PORT ?? 30005}`);
}

export async function deactivate() {
  if (routesModule) {
    routesModule.shutdown();
    routesModule = null;
  }

  if (httpServer) {
    const server = httpServer;
    httpServer = null;
    await new Promise((resolve) => server.close(() => resolve()));
  }
}
