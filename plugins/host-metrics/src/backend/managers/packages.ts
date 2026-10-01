import {
  execCommand,
  execElevated,
  detectPlatform,
  buildListUpgradableCommand,
  buildPackageActionCommand,
  parseUpgradable,
  type PackageAction,
} from "@termix/plugin-sdk/host-commands";
import { isValidPackageName } from "./validation.js";
import type { Router } from "express";
import { managerHandler, ManagerInputError } from "./route-helpers.js";
import type { ManagerRoutesDeps } from "./types.js";

export function registerPackageRoutes(
  app: Router,
  deps: ManagerRoutesDeps,
): void {
  const { validateHostId } = deps;
  /**
   * @openapi
   * /plugin-api/host-metrics/managers/packages/{id}:
   *   get:
   *     summary: List upgradable packages and the package manager
   *     tags: [Host Metrics]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: The package manager and upgradable packages. }
   *       400: { description: Invalid input. }
   *       403: { description: No access to the host, or elevation denied. }
   *       500: { description: The command failed on the host. }
   */
  app.get(
    "/host-metrics/managers/packages/:id",
    validateHostId,
    managerHandler(deps, "connect", "packages_list", async (client) => {
      const platform = await detectPlatform(client);
      const cmd = buildListUpgradableCommand(platform.pkg);
      if (!cmd) return { pkg: platform.pkg, upgradable: [] };
      const { stdout } = await execCommand(client, cmd, 60000);
      return {
        pkg: platform.pkg,
        upgradable: parseUpgradable(platform.pkg, stdout),
      };
    }),
  );

  /**
   * @openapi
   * /plugin-api/host-metrics/managers/packages/{id}/action:
   *   post:
   *     summary: Install or upgrade a package, or upgrade everything
   *     tags: [Host Metrics]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [action]
   *             properties:
   *               action: { type: string, enum: [install, upgrade, upgrade-all] }
   *               pkg: { type: string, description: The package name. Not needed for upgrade-all. }
   *     responses:
   *       200: { description: The command output. }
   *       400: { description: Invalid input. }
   *       403: { description: No access to the host, or elevation denied. }
   *       500: { description: The command failed on the host. }
   */
  app.post(
    "/host-metrics/managers/packages/:id/action",
    validateHostId,
    managerHandler(
      deps,
      "connect",
      "packages_action",
      async (client, host, req) => {
        const { action, pkg: name } = req.body as {
          action?: PackageAction;
          pkg?: string;
        };
        if (
          action !== "upgrade-all" &&
          action !== "install" &&
          action !== "upgrade"
        ) {
          throw new ManagerInputError("Invalid action");
        }
        if (action !== "upgrade-all" && !isValidPackageName(name)) {
          throw new ManagerInputError("Invalid package name");
        }
        const platform = await detectPlatform(client);
        const cmd = buildPackageActionCommand(platform.pkg, action, name);
        if (!cmd) throw new ManagerInputError("No supported package manager");
        // Package operations can be slow; allow up to 10 minutes.
        const result = await execElevated(client, cmd, host.sudoPassword, {
          forceSudo: true,
          timeoutMs: 600000,
        });
        return {
          success: result.code === 0,
          output: (result.stdout || result.stderr).slice(-8000),
        };
      },
    ),
  );
}
