import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  handleTerminalUpgrade,
  sessionManager,
  stopTerminalServer,
} from "../../../../src/backend/hosts/terminal/index.js";

export async function activate(ctx: PluginContext) {
  // Public because the terminal authenticates each socket itself: a share-link
  // guest arrives with a share token instead of a session, so the check has to
  // happen where that token is understood.
  ctx.ws.upgrade(
    "/terminal",
    (request, socket, head) =>
      handleTerminalUpgrade(
        request as Parameters<typeof handleTerminalUpgrade>[0],
        socket as Parameters<typeof handleTerminalUpgrade>[1],
        head as Buffer,
      ),
    { public: true },
  );

  // Published so collab and session-sharing can reach live sessions without
  // importing a plugin. Revoked automatically when this plugin is disabled.
  ctx.registry.provide("terminal.sessions", sessionManager ?? null);

  ctx.log.info("SSH terminal mounted at /plugin-ws/ssh-terminal/terminal");
}

export async function deactivate() {
  await stopTerminalServer();
}
