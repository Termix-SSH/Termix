import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  migrateFileStorage,
  parseEntries,
  writeScript,
} = require("../../../../electron/storage-migrate.cjs");

function fakeWindows(results: unknown[]) {
  const created: Array<Record<string, unknown>> = [];
  class FakeWindow {
    destroyed = false;
    loadFile = vi.fn().mockResolvedValue(undefined);
    loadURL = vi.fn().mockResolvedValue(undefined);
    webContents = { executeJavaScript: vi.fn(async () => results.shift()) };
    constructor(public options: Record<string, unknown>) {
      created.push(this as unknown as Record<string, unknown>);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return { FakeWindow, created };
}

function fakeFs(existing = false) {
  return { existsSync: vi.fn(() => existing), writeFileSync: vi.fn() };
}

const base = {
  partition: "persist:termix",
  markerPath: "/data/app-origin.json",
  fileBlankPath: "/app/electron/storage-blank.html",
  appBlankUrl: "app://termix/__termix-blank.html",
};

describe("migrateFileStorage", () => {
  it("copies file:// storage into the app origin once", async () => {
    const { FakeWindow, created } = fakeWindows([
      JSON.stringify([["theme", "dark"]]),
      1,
    ]);
    const fs = fakeFs();
    const copied = await migrateFileStorage({
      ...base,
      BrowserWindow: FakeWindow,
      fs,
    });
    expect(copied).toBe(1);
    expect(created).toHaveLength(2);
    const [reader, writer] = created as unknown as Array<{
      loadFile: ReturnType<typeof vi.fn>;
      loadURL: ReturnType<typeof vi.fn>;
      options: { webPreferences: Record<string, unknown> };
      destroyed: boolean;
    }>;
    expect(reader.loadFile).toHaveBeenCalledWith(base.fileBlankPath);
    expect(writer.loadURL).toHaveBeenCalledWith(base.appBlankUrl);
    for (const win of [reader, writer]) {
      expect(win.destroyed).toBe(true);
      expect(win.options.webPreferences).toMatchObject({
        partition: base.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      });
      expect(win.options.webPreferences.preload).toBeUndefined();
    }
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      base.markerPath,
      expect.any(String),
    );
  });

  it("does nothing once marked", async () => {
    const { FakeWindow, created } = fakeWindows([]);
    const result = await migrateFileStorage({
      ...base,
      BrowserWindow: FakeWindow,
      fs: fakeFs(true),
    });
    expect(result).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("does not mark a failed move, so it tries again", async () => {
    class Broken {
      webContents = { executeJavaScript: vi.fn() };
      loadFile = vi.fn().mockRejectedValue(new Error("gone"));
      isDestroyed = () => false;
      destroy = vi.fn();
    }
    const fs = fakeFs();
    expect(
      await migrateFileStorage({ ...base, BrowserWindow: Broken, fs }),
    ).toBe(0);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe("storage entries", () => {
  it("keeps only string pairs", () => {
    expect(
      parseEntries(
        JSON.stringify([["a", "1"], ["b", 2], "c", ["d"], ["e", "5"]]),
      ),
    ).toEqual([
      ["a", "1"],
      ["e", "5"],
    ]);
    expect(parseEntries("not json")).toEqual([]);
  });

  it("writes values as data, never as code", () => {
    const script = writeScript([["k", '"); alert(1); ("']]);
    expect(script).toContain(JSON.stringify([["k", '"); alert(1); ("']]));
    expect(script).toContain("localStorage.getItem(key) === null");
  });
});
