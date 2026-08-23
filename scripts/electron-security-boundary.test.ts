import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const main = readFileSync("electron/main.cjs", "utf8");
const preload = readFileSync("electron/preload.js", "utf8");

describe("Electron security boundary", () => {
  it("keeps the renderer sandbox and browser security enabled", () => {
    expect(main).toContain("sandbox: true");
    expect(main).toContain("webSecurity: true");
    expect(main).toContain("allowRunningInsecureContent: false");
    expect(main).toContain("webviewTag: false");
  });

  it("does not expose an unrestricted IPC invoke primitive", () => {
    expect(preload).toContain("invoke: invokeAllowed");
    expect(preload).not.toContain(
      "invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)",
    );
  });
});
