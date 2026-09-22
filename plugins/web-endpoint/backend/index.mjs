/**
 * Web Endpoint - first-party, in-process plugin.
 *
 * This plugin runs on the main thread because its one route is a real
 * transport consumer: it polls the tunnel manager's live maps
 * (activeTunnelRuntimes, connectionStatus, tunnelConnecting), needs the
 * plaintext host credentials ctx.hosts deliberately withholds (PluginHostView
 * is a 13-field allowlist excluding password, key and passphrase), and hands a
 * live ssh2.Client to forwardOut to probe the target. None of that survives
 * the structured-clone postMessage boundary a worker plugin talks over.
 *
 * Unlike every other dispatcher-backed plugin, this one does not register with
 * a dispatcher in database.ts: its route is served by the tunnel service on
 * port 30003, so the dispatcher lives at
 * src/backend/hosts/tunnel/web-endpoint-dispatch.ts instead. Both that service
 * and the plugin runtime load into the same backend process, so the
 * dispatcher's module-level slot is shared between them. Keeping the URL
 * (/ssh/tunnel/web-endpoint/open) byte-identical is also why no nginx change
 * was needed -- the generic /ssh/tunnel/ location block already covers it.
 *
 * Three pieces stay in core rather than moving here:
 *
 *   - The tunnel manager itself (src/backend/hosts/tunnel/manager.ts). It
 *     serves the whole server-tunnels feature, and the reserved "web:" name
 *     prefix that exempts these tunnels from the retry machinery is part of
 *     its own disconnect path.
 *
 *   - host-web-endpoints.ts (the webUiConfig normalizer). Despite its name it
 *     has no router: it is imported by host.ts, host-bulk-routes.ts and
 *     host-normalizers.ts to sanitize the column on every host save and list.
 *     Disabling this plugin must not stop that validation, and core cannot
 *     import plugin code in any case.
 *
 *   - The Electron half (electron/web-endpoint-window.cjs and the two
 *     ipcMain handlers in main.cjs). BrowserWindow and session are
 *     main-process-only, the renderer is what invokes those channels, and the
 *     main process loads no plugin code at all today.
 *
 * The enableWebUi/webUiConfig columns stay on core's ssh_data table, declared
 * here through contributes.hostCapability -- this plugin system has no
 * owned-table migration mechanism of its own.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads a module by its path relative to this file's own directory.
 *
 * The plugin ships beside dist/backend, so in a built server the compiled .js
 * for routes.js sits right next to this .mjs. Under vitest/dev nothing imports
 * this plugin directly (the loader loads in-process plugins with a plain
 * dynamic import, no tsx loader involved), so the only layout that needs to
 * resolve here is the built one.
 */
async function loadRelative(relativePath) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = path.join(here, `${relativePath}.js`);
  return import(new URL(`file://${target.replace(/\\/g, "/")}`).href);
}

let routesModule = null;

export async function activate(ctx) {
  routesModule = await loadRelative("routes");
  routesModule.startWebEndpointService();
  ctx.log.info("Web Endpoint router registered at /ssh/tunnel/web-endpoint");
}

export async function deactivate() {
  if (routesModule) {
    routesModule.stopWebEndpointService();
    routesModule = null;
  }
}
