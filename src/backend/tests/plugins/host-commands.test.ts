import { EventEmitter } from "node:events";
import { describe, it, expect } from "vitest";
import {
  parsePlatformProbe,
  buildPackageActionCommand,
  buildPackageRemoveCommand,
  isValidPackageName,
  buildSudoCommand,
  parseUpgradable,
  execCommand,
  decodeCommandOutput,
} from "@termix-ssh/plugin-sdk/host-commands";

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

class FakeStream extends EventEmitter {
  stderr = new EventEmitter();
  destroy() {}
}

function fakeClient(script: (stream: FakeStream) => void) {
  return {
    exec: (
      _command: string,
      _options: unknown,
      callback: (err: Error | undefined, stream: FakeStream) => void,
    ) => {
      const stream = new FakeStream();
      callback(undefined, stream);
      script(stream);
    },
  } as never;
}

// "The system cannot find the path specified." as the GBK bytes a
// Chinese-locale Windows console actually sends.
const GBK_PATH_ERROR = Buffer.from(
  "cfb5cdb3d5d2b2bbb5bdd6b8b6a8b5c4c2b7beb6a1a3",
  "hex",
);

describe("execCommand", () => {
  it("leaves the command out of the timeout error", async () => {
    const client = { exec: () => {} } as never;
    const command = buildSudoCommand("apt update", "hunter2");
    await expect(execCommand(client, command, 5)).rejects.toThrow(
      /^Command timeout after 5ms$/,
    );
  });

  it("decodes GBK stderr from a localized Windows host", async () => {
    const result = await execCommand(
      fakeClient((stream) => {
        stream.stderr.emit("data", GBK_PATH_ERROR.subarray(0, 7));
        stream.stderr.emit("data", GBK_PATH_ERROR.subarray(7));
        stream.emit("close", 1);
      }),
      "dir",
    );
    expect(result.stderr).toBe("系统找不到指定的路径。");
    expect(result.code).toBe(1);
  });

  it("reassembles a UTF-8 character split across chunks", async () => {
    const utf8 = Buffer.from("以太网 2", "utf8");
    const result = await execCommand(
      fakeClient((stream) => {
        stream.emit("data", utf8.subarray(0, 4)); // cuts 太 in half
        stream.emit("data", utf8.subarray(4));
        stream.emit("close", 0);
      }),
      "ipconfig",
    );
    expect(result.stdout).toBe("以太网 2");
  });

  it("passes plain ASCII output through unchanged", async () => {
    const result = await execCommand(
      fakeClient((stream) => {
        stream.emit("data", Buffer.from("ok\n"));
        stream.stderr.emit("data", Buffer.from("warn\n"));
        stream.emit("close", 0);
      }),
      "echo ok",
    );
    expect(result).toEqual({ stdout: "ok\n", stderr: "warn\n", code: 0 });
  });
});

describe("decodeCommandOutput", () => {
  it("keeps valid UTF-8, including the empty buffer", () => {
    expect(decodeCommandOutput(Buffer.from("以太网 2", "utf8"))).toBe(
      "以太网 2",
    );
    expect(decodeCommandOutput(Buffer.alloc(0))).toBe("");
  });

  it("falls back to GBK when the bytes are not valid UTF-8", () => {
    // "以太网 2" in GBK, the interface name of the metrics widget issue.
    expect(decodeCommandOutput(Buffer.from("d2d4ccabcdf82032", "hex"))).toBe(
      "以太网 2",
    );
    expect(decodeCommandOutput(GBK_PATH_ERROR)).toBe("系统找不到指定的路径。");
  });

  it("keeps lossy UTF-8 when no decoder matches", () => {
    // 0xff is a valid byte in neither UTF-8 nor GBK.
    expect(decodeCommandOutput(Buffer.from([0x68, 0x69, 0xff]))).toBe("hi�");
  });
});
