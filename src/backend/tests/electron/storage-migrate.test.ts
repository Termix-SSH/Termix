import { createRequire } from "node:module";
import nodePath from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  migrateFileStorage,
  cleanEntries,
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
  storageDir: "/data/Partitions/termix/Local Storage/leveldb",
  appBlankUrl: "app://termix/__termix-blank.html",
  path: nodePath,
};

describe("migrateFileStorage", () => {
  it("copies file:// storage into the app origin once", async () => {
    const { FakeWindow, created } = fakeWindows([1]);
    const fs = fakeFs();
    const readStorage = vi.fn(() => [["theme", "dark"]]);
    const copied = await migrateFileStorage({
      ...base,
      BrowserWindow: FakeWindow,
      fs,
      readStorage,
    });
    expect(copied).toBe(1);
    expect(readStorage).toHaveBeenCalledWith(
      expect.objectContaining({ dir: base.storageDir, origin: "file://" }),
    );
    // No page ever opens file://: only the app origin is loaded.
    expect(created).toHaveLength(1);
    const [writer] = created as unknown as Array<{
      loadFile: ReturnType<typeof vi.fn>;
      loadURL: ReturnType<typeof vi.fn>;
      webContents: { executeJavaScript: ReturnType<typeof vi.fn> };
      options: { webPreferences: Record<string, unknown> };
      destroyed: boolean;
    }>;
    expect(writer.loadFile).not.toHaveBeenCalled();
    expect(writer.loadURL).toHaveBeenCalledWith(base.appBlankUrl);
    expect(writer.webContents.executeJavaScript.mock.calls[0][0]).toContain(
      JSON.stringify([["theme", "dark"]]),
    );
    expect(writer.destroyed).toBe(true);
    expect(writer.options.webPreferences).toMatchObject({
      partition: base.partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
    expect(writer.options.webPreferences.preload).toBeUndefined();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      base.markerPath,
      expect.any(String),
    );
  });

  it("opens no window and marks it done when there is nothing to move", async () => {
    const { FakeWindow, created } = fakeWindows([]);
    const fs = fakeFs();
    expect(
      await migrateFileStorage({
        ...base,
        BrowserWindow: FakeWindow,
        fs,
        readStorage: () => [],
      }),
    ).toBe(0);
    expect(created).toHaveLength(0);
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it("does nothing once marked", async () => {
    const { FakeWindow, created } = fakeWindows([]);
    const readStorage = vi.fn();
    const result = await migrateFileStorage({
      ...base,
      BrowserWindow: FakeWindow,
      fs: fakeFs(true),
      readStorage,
    });
    expect(result).toBeNull();
    expect(created).toHaveLength(0);
    expect(readStorage).not.toHaveBeenCalled();
  });

  it("does not mark a failed move, so it tries again", async () => {
    class Broken {
      webContents = { executeJavaScript: vi.fn() };
      loadURL = vi.fn().mockRejectedValue(new Error("gone"));
      isDestroyed = () => false;
      destroy = vi.fn();
    }
    const fs = fakeFs();
    expect(
      await migrateFileStorage({
        ...base,
        BrowserWindow: Broken,
        fs,
        readStorage: () => [["a", "1"]],
      }),
    ).toBe(0);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe("storage entries", () => {
  it("keeps only string pairs", () => {
    expect(
      cleanEntries([["a", "1"], ["b", 2], "c", ["d"], ["e", "5"]]),
    ).toEqual([
      ["a", "1"],
      ["e", "5"],
    ]);
    expect(cleanEntries("not a list")).toEqual([]);
  });

  it("writes values as data, never as code", () => {
    const script = writeScript([["k", '"); alert(1); ("']]);
    expect(script).toContain(JSON.stringify([["k", '"); alert(1); ("']]));
    expect(script).toContain("localStorage.getItem(key) === null");
  });
});
