import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");
const source = readFileSync(path.join(root, "electron/main.cjs"), "utf8");
const temporary: string[] = [];
afterEach(() =>
  temporary
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);

type MenuItem = {
  label?: string;
  checked?: boolean;
  role?: string;
  submenu?: MenuItem[];
  click?: () => void;
};
function harness(platform = "darwin", saved?: string) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "termix-tray-"));
  temporary.push(directory);
  const settingsModule = { exports: {} };
  vm.runInNewContext(
    readFileSync(path.join(root, "electron/desktop-settings.cjs"), "utf8"),
    {
      module: settingsModule,
      process,
      require: (id: string) =>
        id === "electron"
          ? { app: { getPath: () => directory } }
          : id === "fs"
            ? fs
            : path,
    },
  );
  const settings = settingsModule.exports as {
    getDesktopSettings: () => { macTrayIcon: string };
    saveDesktopSettings: (value: { macTrayIcon: string }) => void;
  };
  if (saved) settings.saveDesktopSettings({ macTrayIcon: saved });
  const images: { path: string; setTemplateImage: ReturnType<typeof vi.fn> }[] =
    [];
  const trays: { destroy: ReturnType<typeof vi.fn> }[] = [];
  const app = { name: "Termix", quit: vi.fn() };
  const mainWindow = {
    show: vi.fn(),
    focus: vi.fn(),
    isDestroyed: () => false,
  };
  const createWindow = vi.fn();
  const callbacks = new Map<string, () => void>();
  const context = {
    desktopSettings: settings,
    process: { platform, env: {} },
    path,
    isDev: true,
    appRoot: root,
    tray: null,
    mainWindow,
    app,
    require: () => ({
      nativeImage: {
        createFromPath: (p: string) => {
          const image = { path: p, setTemplateImage: vi.fn() };
          images.push(image);
          return image;
        },
      },
    }),
    Tray: class {
      destroyed = false;
      destroy = vi.fn(() => {
        this.destroyed = true;
      });
      constructor() {
        trays.push(this);
      }
      isDestroyed() {
        return this.destroyed;
      }
      setToolTip() {}
      setContextMenu() {}
      on() {}
    },
    Menu: {
      buildFromTemplate: vi.fn((items: MenuItem[]) => items),
      setApplicationMenu: vi.fn(),
    },
    logToFile: vi.fn(),
    loadLinuxTrayIcon: vi.fn(() => "linux-icon"),
    BrowserWindow: { getAllWindows: () => [] },
    createWindow,
  };
  const functions =
    source.slice(
      source.indexOf("function setMacTrayIcon("),
      source.indexOf("function loadLinuxTrayIcon("),
    ) +
    source.slice(
      source.indexOf("function createMenu("),
      source.indexOf("app.whenReady()"),
    );
  const runtime = vm.runInNewContext(
    functions + "\n({ createTray, createMenu });",
    context,
  ) as { createTray: () => void; createMenu: () => void };
  // Evaluate the real Dock activation and window-close policies, too.
  const lifecycle = source.slice(
    source.indexOf('app.on("window-all-closed"'),
    source.indexOf('app.on("before-quit"'),
  );
  vm.runInNewContext(lifecycle, {
    ...context,
    app: {
      ...app,
      on: (event: string, fn: () => void) => callbacks.set(event, fn),
    },
  });
  return { runtime, settings, images, trays, context, callbacks, createWindow };
}

describe("macOS menu bar icon", () => {
  it("defaults to a transparent template, with an explicit color option", () => {
    const h = harness();
    h.runtime.createTray();
    h.runtime.createMenu();
    expect(h.images[0].path).toMatch(/trayTemplate\.png$/);
    expect(h.images[0].setTemplateImage).toHaveBeenCalledWith(true);
    const menu = h.context.Menu.setApplicationMenu.mock.calls.at(
      -1,
    )![0] as MenuItem[];
    const options = menu[0].submenu!.find(
      (item) => item.label === "Menu Bar Icon",
    )!.submenu!;
    expect(options[0].checked).toBe(true);
    options[1].click!();
    expect(h.trays[0].destroy).toHaveBeenCalledOnce();
    expect(h.settings.getDesktopSettings().macTrayIcon).toBe("color");
    expect(h.images.at(-1)!.path).toMatch(/16x16\.png$/);
    expect(h.images.at(-1)!.setTemplateImage).toHaveBeenCalledWith(false);
  });

  it("hides immediately, persists the choice, and keeps the app menu available to restore it", () => {
    const h = harness();
    h.runtime.createTray();
    h.runtime.createMenu();
    const options = (
      h.context.Menu.setApplicationMenu.mock.calls.at(-1)![0] as MenuItem[]
    )[0].submenu![1].submenu!;
    options[2].click!();
    expect(h.trays[0].destroy).toHaveBeenCalledOnce();
    expect(h.trays).toHaveLength(1);
    expect(h.settings.getDesktopSettings().macTrayIcon).toBe("hidden");
    expect(h.context.mainWindow.show).toHaveBeenCalledOnce();
    const updated = (
      h.context.Menu.setApplicationMenu.mock.calls.at(-1)![0] as MenuItem[]
    )[0].submenu![1].submenu!;
    expect(updated[2].checked).toBe(true);
    updated[0].click!();
    expect(h.trays).toHaveLength(2);
    expect(h.images.at(-1)!.setTemplateImage).toHaveBeenCalledWith(true);
  });

  it("honors hidden on launch while preserving Dock activation and quitting after the last window closes", () => {
    const h = harness("darwin", "hidden");
    h.runtime.createTray();
    h.runtime.createMenu();
    expect(h.trays).toHaveLength(0);
    h.callbacks.get("activate")!();
    expect(h.createWindow).toHaveBeenCalledOnce();
    h.callbacks.get("window-all-closed")!();
    expect(h.context.app.quit).toHaveBeenCalledOnce();
    expect(
      (
        h.context.Menu.setApplicationMenu.mock.calls[0][0] as MenuItem[]
      )[0].submenu!.some((item) => item.role === "quit"),
    ).toBe(true);
  });

  it.each(["win32", "linux"])(
    "does not hide or add macOS options on %s",
    (platform) => {
      const h = harness(platform, "hidden");
      h.runtime.createTray();
      h.runtime.createMenu();
      expect(h.trays).toHaveLength(1);
      expect(h.context.Menu.setApplicationMenu).not.toHaveBeenCalled();
    },
  );

  it.each([1, 2])(
    "ships a transparent, black template at %sx",
    async (scale) => {
      const file = path.join(
        root,
        `public/icons/trayTemplate${scale === 2 ? "@2x" : ""}.png`,
      );
      const { data, info } = await sharp(file)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([16 * scale, 16 * scale]);
      const alpha = [];
      for (let i = 0; i < data.length; i += 4) {
        expect([data[i], data[i + 1], data[i + 2]]).toEqual([0, 0, 0]);
        alpha.push(data[i + 3]);
      }
      expect(alpha).toContain(0);
      expect(alpha.some((value) => value > 0)).toBe(true);
      expect(alpha.filter((value) => value > 0).length).toBeLessThan(
        alpha.length * 0.8,
      );
    },
  );
});
