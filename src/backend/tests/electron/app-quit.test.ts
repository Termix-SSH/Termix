import { EventEmitter } from "node:events";
import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const main = fs.readFileSync(
  new URL("../../../../electron/main.cjs", import.meta.url),
  "utf8",
);
const shell = fs.readFileSync(
  new URL("../../../ui/AppShell.tsx", import.meta.url),
  "utf8",
);

function harness(
  active = true,
  hasTray = true,
  platform: { platform: string; env: Record<string, string> } = {
    platform: "win32",
    env: {},
  },
) {
  const app = new EventEmitter();
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
  return { window, rendererUnload, attemptQuit };
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
  it("minimizes instead of hiding on GNOME, which has no tray by default", () => {
    const app = harness(true, true, {
      platform: "linux",
      env: { XDG_CURRENT_DESKTOP: "ubuntu:GNOME" },
    });
    const event = { preventDefault: vi.fn() };
    app.window.emit("close", event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(app.window.minimize).toHaveBeenCalledOnce();
    expect(app.window.hide).not.toHaveBeenCalled();
  });
  it("quits normally when no connection blocks unloading", () => {
    expect(harness(false).attemptQuit()).toBe(true);
  });
});
