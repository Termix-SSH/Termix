import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveLocalShell, repairSpawnHelpers } =
  require("../../../../electron/local-shell.cjs") as {
    resolveLocalShell: (
      platform: NodeJS.Platform,
      requestedShell?: string,
      env?: NodeJS.ProcessEnv,
      exists?: (file: string) => boolean,
    ) => { file: string; args: string[] };
    repairSpawnHelpers: (
      ptyDir: string,
      fsImpl: {
        statSync: (file: string) => { mode: number };
        chmodSync: (file: string, mode: number) => void;
      },
    ) => number;
  };

describe("resolveLocalShell", () => {
  it("starts the default WSL distribution without PowerShell arguments", () => {
    expect(resolveLocalShell("win32", "wsl", {})).toEqual({
      file: "wsl.exe",
      args: [],
    });
  });

  it("keeps PowerShell as the default Windows shell", () => {
    expect(resolveLocalShell("win32", "default", {})).toEqual({
      file: "powershell.exe",
      args: ["-NoLogo"],
    });
  });

  it("preserves the configured shell on non-Windows platforms", () => {
    expect(
      resolveLocalShell("linux", "wsl", { SHELL: "/bin/fish" }, () => true),
    ).toEqual({
      file: "/bin/fish",
      args: ["-l"],
    });
  });

  it("skips a configured shell that is not installed", () => {
    const installed = new Set(["/bin/bash", "/bin/zsh"]);
    expect(
      resolveLocalShell(
        "darwin",
        undefined,
        { SHELL: "/opt/homebrew/bin/fish" },
        (file) => installed.has(file),
      ).file,
    ).toBe("/bin/zsh");
  });
});

describe("repairSpawnHelpers", () => {
  it("restores the execute bit in the unpacked copy only when it is missing", () => {
    const modes = new Map<string, number>();
    const chmods: Array<[string, number]> = [];
    const fsImpl = {
      statSync: (file: string) => {
        const mode = modes.get(file);
        if (mode === undefined) throw new Error("ENOENT");
        return { mode };
      },
      chmodSync: (file: string, mode: number) => {
        chmods.push([file, mode]);
      },
    };
    const dir =
      "/Applications/Termix.app/Contents/Resources/app.asar/node_modules/node-pty";
    const unpacked = dir.replace("app.asar", "app.asar.unpacked");
    const release = `${unpacked}/build/Release/spawn-helper`;
    modes.set(release.split("/").join(require("node:path").sep), 0o644);
    modes.set(release, 0o644);
    expect(repairSpawnHelpers(dir, fsImpl)).toBe(1);
    expect(chmods[0][1] & 0o111).not.toBe(0);
    expect(chmods[0][0]).toContain("app.asar.unpacked");
  });
});
