import fs from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(fs.readFileSync("electron-builder.json", "utf8"));

describe("Electron fuses", () => {
  it("are all set to the locked down value", () => {
    expect(config.electronFuses).toEqual({
      runAsNode: false,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      loadBrowserProcessSpecificV8Snapshot: false,
      grantFileProtocolExtraPrivileges: false,
      resetAdHocDarwinSignature: true,
    });
  });

  it("start the backend without the runAsNode fuse", () => {
    const main = fs.readFileSync("electron/main.cjs", "utf8");
    expect(main).toContain("utilityProcess.fork(");
    expect(main).not.toMatch(/require\("child_process"\)/);
    expect(main).not.toContain("ELECTRON_RUN_AS_NODE");
  });
});
