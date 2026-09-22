import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  startNetworkTopologyService,
  stopNetworkTopologyService,
} from "./routes.js";

export async function activate(ctx: PluginContext) {
  startNetworkTopologyService(ctx.http.router());
  ctx.log.info(
    "Network Topology routes mounted at /plugin-api/network-topology",
  );
}

export async function deactivate() {
  stopNetworkTopologyService();
}
