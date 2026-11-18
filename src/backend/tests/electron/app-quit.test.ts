import { EventEmitter } from "node:events";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const { closeAction } = createRequire(import.meta.url)(
  "../../../../electron/app-quit.cjs",
);

const main = fs.readFileSync(
  new URL("../../../../electron/main.cjs", import.meta.url),
  "utf8",
);
const shell = fs.readFileSync(
  new URL("../../../ui/shell/controller/use-tabs.ts", import.meta.url),
  "utf8",
);

function harness(
  active = true,
  hasTray = true,
  platform: { platform: string; env: Record<string, string> } = {
    platform: "win32",
    env: {},
  },
  settings: { closeToTray?: boolean } = {},
) {
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() });
  const window = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(),
    hide: vi.fn(),
    minimize: vi.fn(),
  });
  const context = vm.createContext({
    isQuitting: false,
    app,
    mainWindow: window,
    console,
    process: platform,
    tray: hasTray ? { isDestroyed: () => false } : null,
    hasActiveConnection: () => active,
    closeAction,
    desktopSettings: { getDesktopSettings: () => settings },
    showTrayNoticeOnce: vi.fn(),
  });
  // Run the production registrations together, sharing the actual quit flag.
  vm.runInContext(
    main.slice(
      main.indexOf('  mainWindow.webContents.on("did-finish-load"'),
      main.indexOf("  mainWindow.webContents.setWindowOpenHandler"),
    ),
    context,
  );
  vm.runInContext(
    main.slice(
      main.indexOf('app.on("before-quit"'),
      main.indexOf('app.on("will-quit"'),
    ),
    context,
  );
  const unload = shell.slice(
    shell.indexOf("    const handleBeforeUnload ="),
    shell.indexOf('    window.addEventListener("beforeunload"'),
  );
  vm.runInContext(
    unload.replace("(event: BeforeUnloadEvent)", "(event)") +
      "\nglobalThis.unload = handleBeforeUnload;",
    context,
  );
  const rendererUnload = () => {
    const event = { preventDefault: vi.fn(), returnValue: undefined };
    context.unload(event);
    return event.preventDefault.mock.calls.length > 0;
  };
  function attemptQuit() {
    app.emit("before-quit");
    const close = { preventDefault: vi.fn() };
    window.emit("close", close);
    if (close.preventDefault.mock.calls.length) return false;
    if (!rendererUnload()) return true;
    const prevented = { preventDefault: vi.fn() };
    window.webContents.emit("will-prevent-unload", prevented);
    return prevented.preventDefault.mock.calls.length > 0;
  }
  return { app, window, rendererUnload, attemptQuit, context };
}

describe("desktop quit with active connections", () => {
  it.each([true, false])(
    "allows explicit quit when the renderer vetoes unloading (tray: %s)",
    (hasTray) => {
      const app = harness(true, hasTray);
      expect(app.attemptQuit()).toBe(true);
      expect(app.window.hide).not.toHaveBeenCalled();
    },
  );
  it("keeps the unload guard during ordinary navigation or reload", () => {
    const app = harness();
    expect(app.rendererUnload()).toBe(true);
    const event = { preventDefault: vi.fn() };
    app.window.webContents.emit("will-prevent-unload", event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it("continues hiding ordinary window closes in the tray", () => {
    const app = harness();
    const event = { preventDefault: vi.fn() };
    app.window.emit("close", event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(app.window.hide).toHaveBeenCalledOnce();
  });
  it("quits on close on GNOME, which has no tray to come back from", () => {
    const app = harness(true, true, {
      platform: "linux",
      env: { XDG_CURRENT_DESKTOP: "ubuntu:GNOME" },
    });
    const event = { preventDefault: vi.fn() };
    app.window.emit("close", event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(app.window.hide).not.toHaveBeenCalled();
    expect(app.app.quit).toHaveBeenCalledOnce();
    // The renderer's connection guard must not block this quit.
    const unload = { preventDefault: vi.fn() };
    app.window.webContents.emit("will-prevent-unload", unload);
    expect(unload.preventDefault).toHaveBeenCalledOnce();
  });
  it("quits normally when no connection blocks unloading", () => {
    expect(harness(false).attemptQuit()).toBe(true);
  });
  it("shows the tray notice when closing hides the window", () => {
    const app = harness();
    app.window.emit("close", { preventDefault: vi.fn() });
    expect(app.context.showTrayNoticeOnce).toHaveBeenCalledOnce();
  });
  it("quits on close when Close to tray is off", () => {
    const app = harness(true, true, undefined, { closeToTray: false });
    const event = { preventDefault: vi.fn() };
    app.window.emit("close", event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(app.window.hide).not.toHaveBeenCalled();
    expect(app.app.quit).toHaveBeenCalledOnce();
    expect(app.context.showTrayNoticeOnce).not.toHaveBeenCalled();
  });
});

describe("closeAction", () => {
  const base = {
    isQuitting: false,
    hasTray: true,
    platform: "win32",
    env: {},
    closeToTray: undefined as boolean | undefined,
  };
  it("hides to the tray by default", () => {
    expect(closeAction(base)).toBe("hide");
    expect(closeAction({ ...base, closeToTray: true })).toBe("hide");
  });
  it("quits when Close to tray is off", () => {
    expect(closeAction({ ...base, closeToTray: false })).toBe("quit");
  });
  it("lets the window close while quitting or without a tray", () => {
    expect(closeAction({ ...base, isQuitting: true })).toBe("close");
    expect(closeAction({ ...base, hasTray: false })).toBe("close");
  });
});

describe("will-quit waits for the backend", () => {
  function quitHarness(stop: () => Promise<void>) {
    const app = Object.assign(new EventEmitter(), { quit: vi.fn() });
    const context = vm.createContext({
      app,
      tempFiles: new Map(),
      cleanupManagedTempFile: vi.fn(),
      backendProcess: { pid: 1 },
      backendStopping: null,
      stopBackendServer: vi.fn(stop),
    });
    vm.runInContext(
      main.slice(
        main.indexOf("let backendStoppedForQuit"),
        main.indexOf('process.on("uncaughtException"'),
      ),
      context,
    );
    return { app, context };
  }

  it("holds the quit until the backend is gone, then quits", async () => {
    let finish = () => {};
    const { app, context } = quitHarness(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const first = { preventDefault: vi.fn() };
    app.emit("will-quit", first);
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(context.stopBackendServer).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();

    finish();
    await new Promise((resolve) => setImmediate(resolve));
    expect(app.quit).toHaveBeenCalledOnce();

    const second = { preventDefault: vi.fn() };
    app.emit("will-quit", second);
    expect(second.preventDefault).not.toHaveBeenCalled();
  });

  it("lets the app go when there is no backend", () => {
    const { app, context } = quitHarness(() => Promise.resolve());
    context.backendProcess = null;
    const event = { preventDefault: vi.fn() };
    app.emit("will-quit", event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
