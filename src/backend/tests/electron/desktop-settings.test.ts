import fs, { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");
const temporary: string[] = [];
afterEach(() =>
  temporary
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);

function load() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "termix-settings-"));
  temporary.push(directory);
  const module = { exports: {} as Record<string, (...args: never[]) => any> };
  vm.runInNewContext(
    readFileSync(path.join(root, "electron/desktop-settings.cjs"), "utf8"),
    {
      module,
      process,
      require: (id: string) =>
        id === "electron"
          ? { app: { getPath: () => directory } }
          : id === "fs"
            ? fs
            : path,
    },
  );
  return module.exports;
}

describe("desktop settings", () => {
  it("closes to the tray by default", () => {
    const settings = load();
    expect(settings.getDesktopSettings()).toMatchObject({
      closeToTray: true,
      trayNoticeShown: false,
    });
  });

  it("only lets the page change its own settings", () => {
    const { rendererSettings } = load();
    expect(
      rendererSettings({
        closeToTray: false,
        defaultConnectionOrigin: "remote",
        trayNoticeShown: true,
        updateMode: "never",
        macTrayIcon: "hidden",
        other: "x",
      } as never),
    ).toEqual({ closeToTray: false, defaultConnectionOrigin: "remote" });
  });

  it("drops values of the wrong type", () => {
    const { rendererSettings } = load();
    expect(
      rendererSettings({
        closeToTray: "no",
        defaultConnectionOrigin: "elsewhere",
      } as never),
    ).toEqual({});
    expect(rendererSettings(null as never)).toEqual({});
  });

  it("keeps saved settings when one is changed", () => {
    const settings = load();
    settings.saveDesktopSettings({ updateMode: "never" } as never);
    settings.saveDesktopSettings({ closeToTray: false } as never);
    expect(settings.getDesktopSettings()).toMatchObject({
      updateMode: "never",
      closeToTray: false,
    });
  });
});
