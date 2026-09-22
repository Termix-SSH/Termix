import type { Server } from "node:http";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { PORT, shutdown, startHostMetricsService } from "./routes.js";

let httpServer: Server | null = null;

export async function activate(ctx: PluginContext) {
  httpServer = startHostMetricsService();
  ctx.log.info(`Host Metrics listening on ${PORT ?? 30005}`);
}

export async function deactivate() {
  shutdown();

  if (httpServer) {
    const server = httpServer;
    httpServer = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
