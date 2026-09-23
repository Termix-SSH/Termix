import type { PluginContext } from "@termix/plugin-sdk/backend";
import { setPluginSsh } from "./ssh.js";
import {
  getGuacSessionInfo,
  handleGuacamoleUpgrade,
  restartGuacServer,
  startGuacamoleService,
  stopGuacamoleService,
  tokenService,
} from "./guacamole-server.js";
import { startRemoteDesktopService } from "./routes.js";

export async function activate(ctx: PluginContext) {
  setPluginSsh(ctx.ssh);
  ctx.disposables.add(() => setPluginSsh(null));
  await startGuacamoleService();

  startRemoteDesktopService(ctx.http.router());

  // guacamole-lite owns its own WebSocketServer, so it takes the raw upgrade.
  //
  // Public because a Guacamole display authenticates with the encrypted,
  // single-use connection token minted by POST /token, not with a session
  // JWT. guacamole-lite decrypts and validates that token itself, and the
  // route that mints one is authenticated normally.
  ctx.ws.upgrade(
    "/display",
    (request, socket, head) =>
      handleGuacamoleUpgrade(
        request as Parameters<typeof handleGuacamoleUpgrade>[0],
        socket as Parameters<typeof handleGuacamoleUpgrade>[1],
        head as Buffer,
      ),
    { public: true },
  );

  // What collab, session-sharing and the admin guacd setting need from a
  // running Guacamole server. Revoked automatically on deactivate, and
  // hosts/guacamole-sessions.ts degrades safely while it is gone.
  ctx.registry.provide("remote-desktop.sessions", {
    restart: restartGuacServer,
    createJoinToken: (guacamoleConnectionId: string, readOnly: boolean) =>
      tokenService.createJoinToken(guacamoleConnectionId, readOnly),
    getSessionInfo: getGuacSessionInfo,
  });

  ctx.log.info(
    "Remote Desktop mounted at /plugin-api/remote-desktop and /plugin-ws/remote-desktop/display",
  );
}

export async function deactivate() {
  await stopGuacamoleService();
}
