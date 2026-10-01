import { describe, it, expect } from "vitest";
import {
  parsePlatformProbe,
  buildPackageActionCommand,
  buildPackageRemoveCommand,
  isValidPackageName,
  buildSudoCommand,
  parseUpgradable,
} from "@termix/plugin-sdk/host-commands";

describe("parsePlatformProbe", () => {
  it("prefers dnf over yum when both are present", () => {
    const out = ["dnf=1", "yum=1", "apt=0", "pacman=0"].join("\n");
    expect(parsePlatformProbe(out).pkg).toBe("dnf");
  });

  it("reads the pretty OS name and tool flags", () => {
    const out = [
      "systemd=1",
      "apt=1",
      "dnf=0",
      "yum=0",
      "pacman=0",
      "certbot=1",
      "acmesh=0",
      "docker=1",
      "os=Debian GNU/Linux 12 (bookworm)",
    ].join("\n");
    const info = parsePlatformProbe(out);
    expect(info).toMatchObject({
      hasSystemd: true,
      pkg: "apt",
      hasCertbot: true,
      hasAcmeSh: false,
      hasDocker: true,
      osPrettyName: "Debian GNU/Linux 12 (bookworm)",
    });
  });

  it("nulls the OS name when the probe line is empty", () => {
    expect(parsePlatformProbe("os=").osPrettyName).toBeNull();
  });
});

describe("buildPackageActionCommand", () => {
  it("builds install and upgrade-all commands per package manager", () => {
    expect(buildPackageActionCommand("apt", "install", "curl")).toContain(
      "apt-get -y install curl",
    );
    expect(buildPackageActionCommand("dnf", "upgrade-all")).toBe(
      "dnf -y upgrade",
    );
    expect(buildPackageActionCommand("yum", "install", "curl")).toBe(
      "yum -y install curl",
    );
    expect(buildPackageActionCommand("pacman", "upgrade-all")).toBe(
      "pacman -Syu --noconfirm",
    );
  });

  it("returns null when no package manager was detected", () => {
    expect(buildPackageActionCommand(null, "install", "curl")).toBeNull();
  });
});

describe("buildPackageRemoveCommand", () => {
  it("builds the correct remove command per package manager", () => {
    expect(buildPackageRemoveCommand("apt", "curl")).toContain(
      "apt-get -y remove curl",
    );
    expect(buildPackageRemoveCommand("dnf", "curl")).toBe("dnf -y remove curl");
    expect(buildPackageRemoveCommand("yum", "curl")).toBe("yum -y remove curl");
    expect(buildPackageRemoveCommand("pacman", "curl")).toBe(
      "pacman -R --noconfirm curl",
    );
  });

  it("returns null when no package manager was detected", () => {
    expect(buildPackageRemoveCommand(null, "curl")).toBeNull();
  });
});

describe("isValidPackageName", () => {
  it("accepts ordinary package names", () => {
    expect(isValidPackageName("curl")).toBe(true);
    expect(isValidPackageName("lib32-glibc")).toBe(true);
  });

  it("rejects shell metacharacters and empty strings", () => {
    expect(isValidPackageName("curl; rm -rf /")).toBe(false);
    expect(isValidPackageName("")).toBe(false);
    expect(isValidPackageName(123)).toBe(false);
  });
});

describe("buildSudoCommand", () => {
  it("single-quotes the password and wraps the marker echo around the command", () => {
    const cmd = buildSudoCommand("uptime", "p'w");
    expect(cmd).toContain("sudo -S -p ''");
    expect(cmd).toContain("__TX_SUDO_OK__");
    expect(cmd).toContain("uptime");
  });
});

describe("parseUpgradable", () => {
  it("parses apt list --upgradable output", () => {
    const out = "curl/stable 7.88.0 amd64 [upgradable from: 7.87.0]";
    expect(parseUpgradable("apt", out)).toEqual([
      { name: "curl", newVersion: "7.88.0", currentVersion: "7.87.0" },
    ]);
  });

  it("returns an empty list for no package manager", () => {
    expect(parseUpgradable(null, "anything")).toEqual([]);
  });
});
