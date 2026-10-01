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

  it("never hands the linked server's session to the renderer over IPC", () => {
    // The embedded backend owns the link; the renderer asks it, with its
    // own local session, rather than main.
    for (const channel of [
      "get-remote-sync-jwt",
      "save-remote-sync-jwt",
      "notify-local-login",
    ]) {
      expect(main).not.toContain(`"${channel}"`);
      expect(preload).not.toContain(`"${channel}"`);
    }
  });

  it("scopes proxy headers and basic auth to the linked origin", () => {
    expect(main).toContain('"sync-proxy-config"');
    expect(main).toContain("linkedServer.applyLinkHeaders(");
    expect(main).toContain("linkedServer.answerLogin(");
  });
});
