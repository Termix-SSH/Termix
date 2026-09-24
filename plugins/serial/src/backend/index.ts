import type { PluginContext } from "@termix/plugin-sdk/backend";
import { createSerialSession } from "./session.js";

export async function activate(ctx: PluginContext): Promise<void> {
  ctx.ws.route("/console", createSerialSession(ctx));
  ctx.log.info("Serial console mounted at /plugin-ws/serial/console");
}

export async function deactivate(): Promise<void> {
  // The WS route and every open socket are torn down by core: see
  // src/backend/plugins/ws.ts. Nothing here outlives activate().
}
