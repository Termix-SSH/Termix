import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  onHostDeleted,
  onHostLogin,
  onHostUpdated,
  shutdown,
  startHostMetricsService,
} from "./routes.js";

export async function activate(ctx: PluginContext) {
  await startHostMetricsService(ctx.http.router());

  // Core used to POST these to this plugin's own port with an internal auth
  // token. They are events now: no port, no shared secret, and the
  // subscriptions are torn down with the plugin.
  ctx.events.on("host.updated", (payload) => {
    void onHostUpdated(payload as Parameters<typeof onHostUpdated>[0]);
  });
  ctx.events.on("host.deleted", (payload) => {
    onHostDeleted(payload as Parameters<typeof onHostDeleted>[0]);
  });
  ctx.events.on("host.login", (payload) => {
    onHostLogin(payload as Parameters<typeof onHostLogin>[0]);
  });

  ctx.log.info("Host Metrics mounted at /plugin-api/host-metrics");
}

export async function deactivate() {
  shutdown();
}
