import type { PackageManager } from "./platform.js";

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
