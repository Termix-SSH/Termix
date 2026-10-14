import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isLaunchableFileName } = require("../electron/external-editor.cjs") as {
  isLaunchableFileName: (fileName: unknown) => boolean;
};

describe("Electron external editor", () => {
  it("refuses remote file names the OS would run instead of open", () => {
    for (const name of [
      "payload.exe",
      "run.BAT",
      "script.ps1",
      "a.exe. ",
      "a.cmd...",
      "../../evil.vbs",
      "start.command",
      "launch.desktop",
      "install.sh",
    ]) {
      expect(isLaunchableFileName(name)).toBe(true);
    }
  });

  it("opens ordinary text files", () => {
    for (const name of [
      "nginx.conf",
      "README.md",
      "Dockerfile",
      ".bashrc",
      "config.json",
      "index.ts",
      "",
      undefined,
    ]) {
      expect(isLaunchableFileName(name)).toBe(false);
    }
  });
});
