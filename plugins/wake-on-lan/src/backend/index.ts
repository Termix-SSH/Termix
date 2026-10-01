import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { createWakeOnLanService } from "./service.js";
import { registerWakeOnLanRoutes } from "./routes.js";

export async function activate(ctx: PluginContext) {
  const service = createWakeOnLanService(ctx);
  ctx.services.provide("wake-on-lan.send", service);
  registerWakeOnLanRoutes(ctx.http.router<Router>(), ctx, service);
  ctx.log.info("Wake-on-LAN routes mounted at /plugin-api/wake-on-lan");
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
