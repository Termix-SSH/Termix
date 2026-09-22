import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  startNetworkTopologyService,
  stopNetworkTopologyService,
} from "./routes.js";

export async function activate(ctx: PluginContext) {
  startNetworkTopologyService();
  ctx.log.info("Network Topology router registered at /network-topology");
}

export async function deactivate() {
  stopNetworkTopologyService();
}
