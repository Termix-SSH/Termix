import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  TERMINAL_WS_PORT,
  sessionManager,
  startTerminalServer,
  stopTerminalServer,
} from "../../../../src/backend/hosts/terminal/index.js";

export async function activate(ctx: PluginContext) {
  await startTerminalServer();

  // Published so collab and session-sharing can reach live sessions without
  // importing a plugin. Revoked automatically when this plugin is disabled.
  ctx.registry.provide("terminal.sessions", sessionManager ?? null);

  ctx.log.info(`SSH terminal listening on ${TERMINAL_WS_PORT ?? 30002}`);
}

export async function deactivate() {
  await stopTerminalServer();
}
