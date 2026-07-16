import type { Express } from "express";
import { execCommand } from "../widgets/common-utils.js";
import { execElevated } from "./exec-elevated.js";
import { managerHandler, ManagerInputError } from "./route-helpers.js";
import { isValidPackageName } from "./validation.js";
import { detectPlatform, type PackageManager } from "./platform.js";
import type { ManagerRoutesDeps } from "./types.js";

export interface UpgradablePackage {
  name: string;
  currentVersion?: string;
  newVersion?: string;
}

export function buildListUpgradableCommand(pkg: PackageManager): string | null {
  switch (pkg) {
    case "apt":
      return "apt list --upgradable 2>/dev/null | tail -n +2";
    case "dnf":
      return "dnf -q check-update 2>/dev/null || true";
    case "yum":
      return "yum -q check-update 2>/dev/null || true";
    case "pacman":
      return "pacman -Qu 2>/dev/null || true";
    default:
      return null;
  }
}

export function parseUpgradable(
  pkg: PackageManager,
  output: string,
): UpgradablePackage[] {
  const out: UpgradablePackage[] = [];
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (pkg === "apt") {
    for (const line of lines) {
      // name/suite newver arch [upgradable from: oldver]
      const m = line.match(
        /^([^/\s]+)\/\S+\s+(\S+)\s+\S+(?:\s+\[upgradable from:\s+(\S+)\])?/,
      );
      if (m) out.push({ name: m[1], newVersion: m[2], currentVersion: m[3] });
    }
  } else if (pkg === "dnf" || pkg === "yum") {
    for (const line of lines) {
      if (/^(Last metadata|Obsoleting|Security:)/i.test(line)) continue;
      const m = line.match(/^(\S+)\s+(\S+)\s+\S+$/);
      if (m && m[1].includes(".")) out.push({ name: m[1], newVersion: m[2] });
    }
  } else if (pkg === "pacman") {
    for (const line of lines) {
      const m = line.match(/^(\S+)\s+(\S+)\s+->\s+(\S+)$/);
      if (m) out.push({ name: m[1], currentVersion: m[2], newVersion: m[3] });
    }
  }
  return out;
}

export type PackageAction = "upgrade-all" | "install" | "upgrade";

export function buildPackageActionCommand(
  pkg: PackageManager,
  action: PackageAction,
  name?: string,
): string | null {
  const target = name ? ` ${name}` : "";
  switch (pkg) {
    case "apt":
      if (action === "upgrade-all")
        return "DEBIAN_FRONTEND=noninteractive apt-get -y upgrade";
      return `DEBIAN_FRONTEND=noninteractive apt-get -y install${target}`;
    case "dnf":
      return action === "upgrade-all"
        ? "dnf -y upgrade"
        : `dnf -y install${target}`;
    case "yum":
      return action === "upgrade-all"
        ? "yum -y update"
        : `yum -y install${target}`;
    case "pacman":
      return action === "upgrade-all"
        ? "pacman -Syu --noconfirm"
        : `pacman -S --noconfirm${target}`;
    default:
      return null;
  }
}

export function registerPackageRoutes(
  app: Express,
  { validateHostId, runOnHost }: ManagerRoutesDeps,
): void {
  app.get(
    "/host-metrics/managers/packages/:id",
    validateHostId,
    managerHandler(runOnHost, "read", "packages_list", async (client) => {
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
      "execute",
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
