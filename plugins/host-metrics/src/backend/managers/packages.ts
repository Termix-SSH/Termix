import type { Express } from "express";
import { execCommand } from "../../../../../src/backend/hosts/metrics-shared/common-utils.js";
import { execElevated } from "../../../../../src/backend/hosts/metrics-shared/exec-elevated.js";
import { managerHandler, ManagerInputError } from "./route-helpers.js";
import { isValidPackageName } from "../../../../../src/backend/hosts/metrics-shared/validation.js";
import { detectPlatform } from "../../../../../src/backend/hosts/metrics-shared/platform.js";
import {
  buildListUpgradableCommand,
  buildPackageActionCommand,
  parseUpgradable,
  type PackageAction,
} from "../../../../../src/backend/hosts/metrics-shared/package-commands.js";
import type { ManagerRoutesDeps } from "./types.js";

export function registerPackageRoutes(
  app: Express,
  { validateHostId, runOnHost }: ManagerRoutesDeps,
): void {
  app.get(
    "/host-metrics/managers/packages/:id",
    validateHostId,
    managerHandler(runOnHost, "connect", "packages_list", async (client) => {
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

  app.post(
    "/host-metrics/managers/packages/:id/action",
    validateHostId,
    managerHandler(
      runOnHost,
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
