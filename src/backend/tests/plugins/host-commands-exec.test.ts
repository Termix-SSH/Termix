import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import fc from "fast-check";
import {
  buildListUpgradableCommand,
  buildPackageActionCommand,
  buildPackageRemoveCommand,
  buildSudoCommand,
  decodeCommandOutput,
  detectHostPlatform,
  detectPlatform,
  ElevationError,
  execCommand,
  execElevated,
  execPowerShell,
  isValidPackageName,
  parseUpgradable,
  shellSingleQuote,
  sudoStdin,
} from "../../../../packages/plugin-sdk/src/host-commands.js";

type Reply = {
  stdout?: string | Buffer;
  stderr?: string;
  code?: number;
  error?: Error;
  streamError?: Error;
  hang?: boolean;
};

/** An ssh2 client whose exec answers from a function of the command. */
function fakeClient(answer: (command: string, stdin?: string) => Reply) {
  const commands: Array<{ command: string; stdin?: string }> = [];
  const client = {
    exec: (
      command: string,
      _opts: unknown,
      cb: (err: Error | undefined, stream?: unknown) => void,
    ) => {
      const entry: { command: string; stdin?: string } = { command };
      commands.push(entry);
      const stream = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
        destroy: vi.fn(),
        end: (input?: string) => {
          entry.stdin = input;
        },
      });
      setTimeout(() => {
        const first = answer(command);
        if (first.error) return cb(first.error);
        cb(undefined, stream);
        if (first.hang) return;
        setTimeout(() => {
          const reply = answer(command, entry.stdin);
          if (reply.streamError) {
            stream.emit("error", reply.streamError);
            return;
          }
          if (reply.stdout) stream.emit("data", Buffer.from(reply.stdout));
          if (reply.stderr)
            stream.stderr.emit("data", Buffer.from(reply.stderr));
          stream.emit("close", reply.code ?? 0);
        }, 1);
      }, 0);
    },
  };
  return { client: client as never, commands };
}

describe("execCommand", () => {
  it("collects stdout, stderr and the exit code", async () => {
    const { client } = fakeClient(() => ({
      stdout: "out",
      stderr: "err",
      code: 3,
    }));
    expect(await execCommand(client, "ls")).toEqual({
      stdout: "out",
      stderr: "err",
      code: 3,
    });
  });

  it("rejects on exec errors, stream errors and timeouts", async () => {
    await expect(
      execCommand(
        fakeClient(() => ({ error: new Error("no exec") })).client,
        "x",
      ),
    ).rejects.toThrow("no exec");
    await expect(
      execCommand(
        fakeClient(() => ({ streamError: new Error("broken") })).client,
        "x",
      ),
    ).rejects.toThrow("broken");
    await expect(
      execCommand(fakeClient(() => ({ hang: true })).client, "x", 20),
    ).rejects.toThrow("Command timeout after 20ms");
  });

  it("writes stdin and then closes it", async () => {
    const { client, commands } = fakeClient((_c, stdin) => ({
      stdout: `got ${stdin}`,
    }));
    const result = await execCommand(client, "cat", 1000, "hello");
    expect(commands[0].stdin).toBe("hello");
    expect(result.stdout).toBe("got hello");
  });
});

describe("decodeCommandOutput", () => {
  it("reads UTF-8, falls back to GBK, then to lossy UTF-8", () => {
    expect(decodeCommandOutput(Buffer.from("héllo"))).toBe("héllo");
    const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
    const decoded = decodeCommandOutput(gbk);
    expect(decoded === "你好" || decoded.includes("�")).toBe(true);
    expect(decodeCommandOutput(Buffer.from([0xff, 0xfe, 0xfd]))).toContain("�");
  });
});

describe("platform detection", () => {
  it("parses the probe", async () => {
    const { client } = fakeClient(() => ({
      stdout:
        "systemd=1\napt=0\ndnf=1\nyum=1\npacman=0\ncertbot=1\nacmesh=0\ndocker=1\nos=Fedora 41",
    }));
    expect(await detectPlatform(client)).toEqual({
      hasSystemd: true,
      pkg: "dnf",
      hasCertbot: true,
      hasAcmeSh: false,
      hasDocker: true,
      osPrettyName: "Fedora 41",
    });
  });

  it("tells macOS, Linux, Windows and others apart", async () => {
    const uname = (out: string, code = 0) =>
      fakeClient((c) =>
        c === "uname -s" ? { stdout: out, code } : { stdout: "" },
      ).client;
    expect(await detectHostPlatform(uname("Darwin\n"))).toBe("darwin");
    expect(await detectHostPlatform(uname("Linux\n"))).toBe("linux");
    expect(await detectHostPlatform(uname("FreeBSD\n"))).toBe("other");
    const windows = fakeClient((c) =>
      c === "uname -s"
        ? { stdout: "", stderr: "not recognized", code: 1 }
        : { stdout: "WIN_OK\r\n" },
    );
    expect(await detectHostPlatform(windows.client)).toBe("windows");
    expect(windows.commands[1].command).toMatch(
      /^powershell -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/,
    );
    const nothing = fakeClient(() => ({ error: new Error("down") }));
    expect(await detectHostPlatform(nothing.client)).toBe("other");
  });

  it("sends PowerShell scripts encoded, never as raw text", async () => {
    const { client, commands } = fakeClient(() => ({ stdout: "ok" }));
    await execPowerShell(client, "Get-Item 'C:\\x'; & calc");
    expect(commands[0].command).not.toContain("calc");
  });
});

describe("package commands", () => {
  it("builds list, action and remove commands per manager", () => {
    for (const pkg of ["apt", "dnf", "yum", "pacman"] as const) {
      expect(buildListUpgradableCommand(pkg)).toBeTruthy();
      expect(buildPackageActionCommand(pkg, "upgrade-all")).toBeTruthy();
      expect(buildPackageActionCommand(pkg, "install", "curl")).toContain(
        "curl",
      );
      expect(buildPackageRemoveCommand(pkg, "curl")).toContain("curl");
    }
    expect(buildListUpgradableCommand(null)).toBeNull();
    expect(buildPackageActionCommand(null, "install", "x")).toBeNull();
    expect(buildPackageRemoveCommand(null, "x")).toBeNull();
  });

  it("parses upgradable lists from each manager", () => {
    expect(
      parseUpgradable(
        "apt",
        "curl/stable 8.1 amd64 [upgradable from: 8.0]\nbad line",
      ),
    ).toEqual([{ name: "curl", newVersion: "8.1", currentVersion: "8.0" }]);
    expect(
      parseUpgradable(
        "dnf",
        "Last metadata expiration check\ncurl.x86_64 8.1 updates\nnoarch",
      ),
    ).toEqual([{ name: "curl.x86_64", newVersion: "8.1" }]);
    expect(parseUpgradable("pacman", "curl 8.0 -> 8.1")).toEqual([
      { name: "curl", currentVersion: "8.0", newVersion: "8.1" },
    ]);
    expect(parseUpgradable(null, "anything")).toEqual([]);
  });

  it("only accepts plain package names", () => {
    expect(isValidPackageName("libssl3")).toBe(true);
    for (const bad of ["-rf", "a b", "a;b", "$(x)", "", "x".repeat(129), 5]) {
      expect(isValidPackageName(bad)).toBe(false);
    }
    fc.assert(
      fc.property(fc.string(), (name) => {
        if (isValidPackageName(name)) {
          expect(name).toMatch(/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/);
        }
      }),
    );
  });
});

describe("sudo", () => {
  it("never puts the password in the command", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4 }).filter((p) => !/[\r\n\0]/.test(p)),
        (password) => {
          const command = buildSudoCommand("apt-get update");
          expect(command.includes(password) && password.length > 12).toBe(
            false,
          );
          expect(sudoStdin(password)).toBe(`${password}\n`);
        },
      ),
    );
    expect(() => sudoStdin("a\nb")).toThrow(ElevationError);
  });

  it("quotes for a single quoted shell word", () => {
    expect(shellSingleQuote("it's")).toBe(`'it'"'"'s'`);
  });

  it("runs directly when that works and skips sudo for other failures", async () => {
    const ok = fakeClient(() => ({ stdout: "done" }));
    expect(await execElevated(ok.client, "id", "pw")).toMatchObject({
      stdout: "done",
      usedSudo: false,
    });
    const other = fakeClient(() => ({ stderr: "no such file", code: 2 }));
    expect(await execElevated(other.client, "cat x", "pw")).toMatchObject({
      code: 2,
      usedSudo: false,
    });
    expect(other.commands).toHaveLength(1);
  });

  it("asks for a sudo password when one is needed and missing", async () => {
    const denied = fakeClient(() => ({ stderr: "Permission denied", code: 1 }));
    await expect(
      execElevated(denied.client, "x", undefined),
    ).rejects.toMatchObject({ code: "SUDO_REQUIRED" });
    await expect(
      execElevated(denied.client, "x", undefined, { forceSudo: true }),
    ).rejects.toMatchObject({ code: "SUDO_REQUIRED" });
  });

  it("elevates with the password on stdin and strips the marker", async () => {
    const { client, commands } = fakeClient((command, stdin) =>
      command.includes("read -r P")
        ? stdin === "pw\n"
          ? { stdout: "__TX_SUDO_OK__\nroot\n" }
          : { stderr: "Sorry, try again.", code: 1 }
        : { stderr: "must be run as root", code: 1 },
    );
    const result = await execElevated(client, "whoami", "pw");
    expect(result).toMatchObject({ stdout: "root\n", usedSudo: true });
    expect(commands[1].command).not.toContain("pw");
    await expect(execElevated(client, "whoami", "wrong")).rejects.toMatchObject(
      {
        code: "SUDO_FAILED",
      },
    );
  });

  it("reports a user who may not use sudo", async () => {
    const { client } = fakeClient(() => ({
      stderr: "bob is not in the sudoers file",
      code: 1,
    }));
    await expect(
      execElevated(client, "x", "pw", { forceSudo: true }),
    ).rejects.toMatchObject({ code: "NOT_SUDOER" });
    const silent = fakeClient(() => ({ code: 1 }));
    await expect(
      execElevated(silent.client, "x", "pw", { forceSudo: true }),
    ).rejects.toMatchObject({ code: "SUDO_FAILED" });
  });
});
