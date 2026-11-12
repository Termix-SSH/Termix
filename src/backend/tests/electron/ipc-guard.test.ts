import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  createIpcGuard,
  validators: v,
} = require("../../../../electron/ipc-guard.cjs");
const { IPC_ARGS } = require("../../../../electron/ipc-args.cjs");

function setup() {
  const mainFrame = { url: "app://termix/index.html" };
  const webContents = { mainFrame };
  const main = { webContents, isDestroyed: () => false };
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) =>
      handlers.set(channel, fn),
    on: (channel: string, fn: (...args: unknown[]) => unknown) =>
      handlers.set(channel, fn),
  };
  const guard = createIpcGuard({
    ipcMain,
    getMainWindow: () => main,
    isAppUrl: (url: string) => url.startsWith("app://termix/"),
    args: IPC_ARGS,
  });
  const fromApp = { sender: webContents, senderFrame: mainFrame };
  return { guard, handlers, webContents, mainFrame, fromApp };
}

describe("IPC guard", () => {
  it("lets the app page call and passes the checked arguments", async () => {
    const { guard, handlers, fromApp } = setup();
    const fn = vi.fn((_e: unknown, key: string) => key);
    guard.handle("get-setting", fn);
    expect(handlers.get("get-setting")!(fromApp, "theme")).toBe("theme");
  });

  it("refuses a frame inside the page", () => {
    const { guard, handlers, webContents } = setup();
    guard.handle("get-app-version", () => "1");
    const sub = { sender: webContents, senderFrame: { url: "app://termix/x" } };
    expect(() => handlers.get("get-app-version")!(sub)).toThrow(/Not allowed/);
  });

  it("refuses another window", () => {
    const { guard, handlers, mainFrame } = setup();
    guard.handle("get-app-version", () => "1");
    const other = { sender: {}, senderFrame: mainFrame };
    expect(() => handlers.get("get-app-version")!(other)).toThrow(
      /Not allowed/,
    );
  });

  it("refuses the main frame once it shows a foreign page", () => {
    const { guard, handlers, fromApp, mainFrame } = setup();
    guard.handle("get-app-version", () => "1");
    mainFrame.url = "https://evil.example/";
    expect(() => handlers.get("get-app-version")!(fromApp)).toThrow(
      /Not allowed/,
    );
  });

  it("refuses a destroyed frame", () => {
    const { guard, handlers, webContents } = setup();
    guard.handle("get-app-version", () => "1");
    expect(() =>
      handlers.get("get-app-version")!({
        sender: webContents,
        senderFrame: null,
      }),
    ).toThrow();
  });

  it("drops one way messages it refuses", () => {
    const { guard, handlers, webContents } = setup();
    const fn = vi.fn();
    guard.on("set-tray-notice-text", fn);
    handlers.get("set-tray-notice-text")!(
      { sender: webContents, senderFrame: { url: "https://evil.example" } },
      { title: "a", body: "b" },
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it("will not register a handler with arguments and no check", () => {
    const { guard } = setup();
    expect(() =>
      guard.handle("unchecked-channel", (_e: unknown, x: unknown) => x),
    ).toThrow(/no argument check/);
  });
});

describe("IPC argument checks", () => {
  it.each([
    "__proto__",
    "constructor",
    "prototype",
    "",
    "a b",
    "x".repeat(129),
  ])("refuses setting key %j", (key) => {
    expect(() => IPC_ARGS["set-setting"](key, 1)).toThrow();
  });

  it("refuses a huge setting value", () => {
    expect(() => IPC_ARGS["set-setting"]("k", "x".repeat(70 * 1024))).toThrow();
  });

  it("keeps only known dialog fields", () => {
    const [options] = IPC_ARGS["show-open-dialog"]({
      title: "Pick",
      properties: ["openFile", "evilFlag"],
      securityScopedBookmarks: true,
      filters: [{ name: "Exe", extensions: ["exe"] }],
    });
    expect(options).toEqual({
      title: "Pick",
      properties: ["openFile"],
      filters: [{ name: "Exe", extensions: ["exe"] }],
    });
  });

  it("refuses bad filter extensions", () => {
    expect(() =>
      IPC_ARGS["show-save-dialog"]({
        filters: [{ name: "x", extensions: ["a/b"] }],
      }),
    ).toThrow();
  });

  it("checks temp ids and encodings", () => {
    expect(IPC_ARGS["cleanup-temp-file"]("123-abc")).toEqual(["123-abc"]);
    expect(() => IPC_ARGS["cleanup-temp-file"]("../../x")).toThrow();
    expect(() =>
      IPC_ARGS["create-temp-file"]({
        fileName: "a",
        content: "",
        encoding: "hex",
      }),
    ).toThrow();
    expect(() => IPC_ARGS["start-drag-files"](["1-a", "../x"])).toThrow();
  });

  it("checks title bar colors", () => {
    expect(IPC_ARGS["set-title-bar-overlay"]({ color: "#0f0f14" })).toEqual([
      { color: "#0f0f14" },
    ]);
    expect(() =>
      IPC_ARGS["set-title-bar-overlay"]({ color: "url(javascript:1)" }),
    ).toThrow();
  });

  it("checks the update mode and the tray text", () => {
    expect(() => IPC_ARGS["desktop-update-set-mode"]("sometimes")).toThrow();
    expect(() =>
      IPC_ARGS["set-tray-notice-text"]({ title: 1, body: "" }),
    ).toThrow();
  });

  it("checks embedded view ids and bounds", () => {
    expect(
      IPC_ARGS["embedded-view-bounds"]("v1", { x: -5, y: "2", width: 1e9 }),
    ).toEqual(["v1", { x: 0, y: 2, width: 100000, height: 0 }]);
    expect(() => IPC_ARGS["embedded-view-close"]("a/b")).toThrow();
    expect(
      v.viewOpen({ id: "a", url: "https://x", ignoreCert: "yes" }).ignoreCert,
    ).toBe(false);
  });
});

describe("main.cjs", () => {
  const main = fs.readFileSync("electron/main.cjs", "utf8");

  it("registers no IPC handler outside the guard", () => {
    expect(main).not.toMatch(/ipcMain\.(handle|on|once|handleOnce)\(/);
  });

  it("has an argument check for every channel whose handler takes arguments", () => {
    const channels = [
      ...main.matchAll(
        /ipc\.(?:handle|on)\(\s*"([^"]+)",\s*(?:async\s*)?\(([^)]*)\)/g,
      ),
    ];
    expect(channels.length).toBeGreaterThan(20);
    for (const [, channel, params] of channels) {
      const count = params.split(",").filter((p) => p.trim()).length;
      if (count > 1) expect(IPC_ARGS[channel], channel).toBeTypeOf("function");
    }
  });

  it("writes the page that reads old storage itself, so packaging can't drop it", () => {
    expect(main).toMatch(/fs\.writeFileSync\(fileBlankPath/);
    expect(main).not.toMatch(/__dirname, "storage-blank\.html"/);
  });

  it("serves the page from app://, never file://", () => {
    expect(main).not.toMatch(/\.loadFile\(/);
    expect(main).toContain("appProtocol.APP_INDEX_URL");
  });

  it("denies webviews and stray windows everywhere", () => {
    expect(main).toContain('"web-contents-created"');
    expect(main).toContain('"will-attach-webview"');
    expect(main).toMatch(
      /for \(const name of \["will-navigate", "will-redirect"\]\)/,
    );
  });
});
