import type { Express } from "express";
import { detectPlatform } from "./platform.js";
import { managerHandler } from "./route-helpers.js";
import type { ManagerRoutesDeps } from "./types.js";
import { registerServiceRoutes } from "./services.js";
import { registerProcessRoutes } from "./processes.js";
import { registerSimpleReadRoutes } from "./simple-reads.js";
import { registerCronRoutes } from "./cron.js";
import { registerPackageRoutes } from "./packages.js";
import { registerSslRoutes } from "./ssl.js";
import { registerFirewallRoutes } from "./firewall.js";
import { registerUserRoutes } from "./users.js";
import { registerHealthRoutes } from "./health.js";
import { registerLogRoutes } from "./logs.js";
import { registerWireGuardRoutes } from "./wireguard.js";
import { registerTailscaleRoutes } from "./tailscale.js";

/**
 * Registers every Host Metrics manager route under the `/host-metrics/managers`
 * prefix on the stats app. All routes are on-demand (not polled).
 */
export function registerManagerRoutes(
  app: Express,
  deps: ManagerRoutesDeps,
): void {
  const { validateHostId, runOnHost } = deps;

  /**
   * @openapi
   * /host-metrics/platform/{id}:
   *   get:
   *     summary: Detect available management tooling on a host
   *     tags:
   *       - Host Metrics
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Platform capabilities (systemd, package manager, certbot, docker).
   */
  app.get(
    "/host-metrics/platform/:id",
    validateHostId,
    managerHandler(runOnHost, "read", "platform_detect", (client) =>
      detectPlatform(client),
    ),
  );

  registerServiceRoutes(app, deps);
  registerProcessRoutes(app, deps);
  registerSimpleReadRoutes(app, deps);
  registerCronRoutes(app, deps);
  registerPackageRoutes(app, deps);
  registerSslRoutes(app, deps);
  registerFirewallRoutes(app, deps);
  registerUserRoutes(app, deps);
  registerHealthRoutes(app, deps);
  registerLogRoutes(app, deps);
  registerWireGuardRoutes(app, deps);
  registerTailscaleRoutes(app, deps);
}
