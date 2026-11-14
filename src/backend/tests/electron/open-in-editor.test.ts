import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  openInEditor,
  isLaunchable,
} = require("../../../../electron/open-in-editor.cjs");

function fakeSpawn(fail?: Error) {
  return vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    setImmediate(() =>
      fail ? child.emit("error", fail) : child.emit("spawn"),
    );
    return child;
  });
}

describe("open in editor", () => {
  it("starts the saved editor with the file, detached", async () => {
    const spawn = fakeSpawn();
    const result = await openInEditor("/tmp/a.txt", {
      editorPath: () => "/usr/bin/code",
      spawn,
      openPath: vi.fn(),
    });
    expect(result).toEqual({ success: true });
    expect(spawn).toHaveBeenCalledWith("/usr/bin/code", ["/tmp/a.txt"], {
      detached: true,
      stdio: "ignore",
    });
  });

  it("uses the default app without an editor, but never for a program", async () => {
    const openPath = vi.fn(async () => "");
    const spawn = fakeSpawn();
    const deps = { editorPath: () => null, spawn, openPath };
    expect(await openInEditor("/tmp/a.txt", deps)).toEqual({ success: true });
    expect(await openInEditor("C:\\tmp\\run.exe. ", deps)).toMatchObject({
      success: false,
    });
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reports an editor that won't start", async () => {
    const result = await openInEditor("/tmp/a.txt", {
      editorPath: () => "/missing",
      spawn: fakeSpawn(new Error("ENOENT")),
      openPath: vi.fn(),
    });
    expect(result).toEqual({ success: false, error: "ENOENT" });
  });

  it("knows the usual launchable types", () => {
    expect(isLaunchable("x.BAT")).toBe(true);
    expect(isLaunchable("x.sh")).toBe(true);
    expect(isLaunchable("x.md")).toBe(false);
  });
});
