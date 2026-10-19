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

  it("never hands the session cookie to the renderer over IPC", () => {
    for (const channel of ["get-session-cookie", "wait-session-cookie"]) {
      expect(main).not.toContain(`"${channel}"`);
      expect(preload).not.toContain(`"${channel}"`);
    }
  });

  it("saves an external editor only if it was chosen in a file dialog", () => {
    expect(main).toContain("dialogChosenPaths.has(value)");
  });

  it("keeps local files, the local terminal and the external editor out of Electron", () => {
    for (const channel of [
      "open-external-editor",
      "close-external-editor",
      "local-terminal-start",
      "local-fs:",
      "local-transfer:",
      "list-local-directory",
    ]) {
      expect(main).not.toContain(channel);
      expect(preload).not.toContain(channel);
    }
  });

  it("scopes proxy headers and basic auth to the linked origin", () => {
    expect(main).toContain('"sync-proxy-config"');
    expect(main).toContain("linkedServer.applyLinkHeaders(");
    expect(main).toContain("linkedServer.answerLogin(");
  });
});

it("rejects setting keys that coerce to the protected editor key", async () => {
  const { runInNewContext } = await import("node:vm");
  const { vi } = await import("vitest");
  const writeFileSync = vi.fn();
  let handler: (event: unknown, key: unknown, value: unknown) => unknown;
  runInNewContext(
    main.slice(
      main.indexOf('ipcMain.handle("set-setting"'),
      main.indexOf('ipcMain.handle("clear-session-cookies"'),
    ),
    {
      ipcMain: {
        handle: (_: string, callback: typeof handler) => {
          handler = callback;
        },
      },
      EXTERNAL_EDITOR_SETTING: "fileManager.externalEditorPath",
      dialogChosenPaths: new Set(["/chosen/editor"]),
      app: { getPath: () => "/settings" },
      path: { join: (...parts: string[]) => parts.join("/") },
      fs: { existsSync: () => false, mkdirSync: vi.fn(), writeFileSync },
      console,
    },
  );
  for (const key of [["fileManager.externalEditorPath"], null, {}, 42]) {
    expect(handler!({}, key, "/unapproved/editor")).toEqual({
      success: false,
      error: "Invalid setting key",
    });
  }
  expect(writeFileSync).not.toHaveBeenCalled();
  expect(
    handler!({}, "fileManager.externalEditorPath", "/unapproved/editor"),
  ).toEqual({ success: false, error: "Choose the editor in the file dialog" });
  expect(
    handler!({}, "fileManager.externalEditorPath", "/chosen/editor"),
  ).toEqual({ success: true });
  expect(writeFileSync).toHaveBeenCalledOnce();
});
