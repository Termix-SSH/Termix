/**
 * Remote Desktop (RDP/VNC/Telnet) - first-party, in-process plugin.
 *
 * Runs on the main thread rather than in a worker for the same class of
 * reason as ssh-terminal/docker (see src/backend/plugins/first-party.ts): it
 * owns a WebSocket server (guacamole-lite) on port 30008, and its
 * /connect-host/:hostId route does multi-step credential/tunnel resolution
 * (jump-host SSH tunnels, a macOS VNC compatibility proxy) involving raw
 * net.Socket plumbing the worker's structured-clone postMessage boundary
 * cannot carry.
 *
 * guacd itself is not a process this plugin spawns: it is a separate
 * external service (a sibling Docker container by default, or any
 * network-reachable guacd) reached over plain TCP. See guacd-config.ts's
 * resolveGuacdOptions(). There is nothing to supervise here - guacd's
 * availability is handled as an external dependency with graceful
 * degradation, same as before this plugin existed.
 *
 * Its backend logic is real TypeScript physically relocated here (routes.ts,
 * guacamole-server.ts, token-service.ts, etc.), compiled by
 * scripts/copy-bundled-plugins.cjs like docker's plugin backend, rather than
 * kept as a thin wrapper over code left in core -- see that script's own
 * comment for why. The one piece that stays in core is
 * src/backend/database/routes/guacamole-dispatch.ts, since it is what
 * database.ts mounts permanently at /guacamole regardless of whether this
 * plugin is installed.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

async function loadRelative(relativePath) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const target = path.join(here, `${relativePath}.js`);
  return import(new URL(`file://${target.replace(/\\/g, "/")}`).href);
}

let guacServerModule = null;
let dispatchModule = null;

export async function activate(ctx) {
  const [server, routes, dispatch] = await Promise.all([
    loadRelative("guacamole-server"),
    loadRelative("routes"),
    loadRelative("../../../backend/backend/database/routes/guacamole-dispatch"),
  ]);

  guacServerModule = server;
  dispatchModule = dispatch;

  await server.startGuacamoleService();
  dispatch.registerGuacamoleBridge({
    router: routes.router,
    restart: server.restartGuacServer,
    createJoinToken: (guacamoleConnectionId, readOnly) =>
      server.tokenService.createJoinToken(guacamoleConnectionId, readOnly),
    getSessionInfo: server.getGuacSessionInfo,
  });

  ctx.log.info(
    `Remote Desktop listening on ${server.GUAC_WS_PORT ?? 30008}`,
  );
}

export async function deactivate() {
  if (dispatchModule) {
    dispatchModule.unregisterGuacamoleBridge();
    dispatchModule = null;
  }
  if (guacServerModule) {
    await guacServerModule.stopGuacamoleService();
    guacServerModule = null;
  }
}
