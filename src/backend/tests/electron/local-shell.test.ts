import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveLocalShell } =
  require("../../../../electron/local-shell.cjs") as {
    resolveLocalShell: (
      platform: NodeJS.Platform,
      requestedShell?: string,
      env?: NodeJS.ProcessEnv,
    ) => { file: string; args: string[] };
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
    expect(resolveLocalShell("linux", "wsl", { SHELL: "/bin/fish" })).toEqual({
      file: "/bin/fish",
      args: ["-l"],
    });
  });
});
