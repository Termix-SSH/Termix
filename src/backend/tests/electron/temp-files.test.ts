import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  DEFAULT_MAX_TOTAL_BYTES,
  createTempFileManager,
  sanitizeFileName,
} = require("../../../../electron/temp-files.cjs");
const { IPC_ARGS } = require("../../../../electron/ipc-args.cjs");

describe("electron temp file manager", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-temp-files-test-"));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("creates, tracks, and cleans up temp files with valid IPC tempId", () => {
    const manager = createTempFileManager({
      getTempRoot: () => path.join(rootDir, "termix"),
    });

    const created = manager.createTempFile("hello.txt", "world", "utf8");
    expect(IPC_ARGS["cleanup-temp-file"](created.tempId)).toEqual([
      created.tempId,
    ]);
    expect(fs.readFileSync(created.path, "utf8")).toBe("world");
    expect(manager.getTempPath(created.tempId)).toBe(created.path);
    expect(manager.getTotalBytes()).toBe(5);

    manager.cleanupTempFile(created.tempId);
    expect(manager.getTempPath(created.tempId)).toBeUndefined();
    expect(manager.getTotalBytes()).toBe(0);
    expect(fs.existsSync(created.path)).toBe(false);
  });

  it("creates temp folders, decodes base64, and neutralizes traversal segments", () => {
    const manager = createTempFileManager({
      getTempRoot: () => path.join(rootDir, "termix"),
    });

    const created = manager.createTempFolder("export", [
      {
        relativePath: "../escape/../../nested/data.bin",
        content: Buffer.from("abc").toString("base64"),
        encoding: "base64",
      },
    ]);

    const expectedFile = path.join(
      created.path,
      "escape",
      "nested",
      "data.bin",
    );
    expect(fs.readFileSync(expectedFile, "utf8")).toBe("abc");
    expect(expectedFile.startsWith(created.path)).toBe(true);
    expect(sanitizeFileName("..")).toBe("file");
    expect(sanitizeFileName(".")).toBe("file");

    manager.cleanupAll();
    expect(fs.existsSync(created.path)).toBe(false);
    expect(manager.size()).toBe(0);
    expect(manager.getTotalBytes()).toBe(0);
  });

  it("enforces total byte quota across files and folders", () => {
    expect(DEFAULT_MAX_TOTAL_BYTES).toBe(512 * 1024 * 1024);

    const manager = createTempFileManager({
      getTempRoot: () => path.join(rootDir, "termix"),
      maxTotalBytes: 10,
    });

    const first = manager.createTempFile("a.txt", "123456", "utf8");
    expect(() => manager.createTempFile("b.txt", "12345", "utf8")).toThrow(
      /quota exceeded/i,
    );
    expect(() =>
      manager.createTempFolder("dir", [
        { relativePath: "x.txt", content: "123", encoding: "utf8" },
        { relativePath: "y.txt", content: "12", encoding: "utf8" },
      ]),
    ).toThrow(/quota exceeded/i);

    manager.cleanupTempFile(first.tempId);
    const second = manager.createTempFile("b.txt", "1234567890", "utf8");
    expect(fs.readFileSync(second.path, "utf8")).toBe("1234567890");
    manager.cleanupAll();
  });

  it("evicts expired entries on TTL sweep and frees quota before new writes", () => {
    let clock = 1_000_000;
    const tempRoot = path.join(rootDir, "termix");
    const manager = createTempFileManager({
      getTempRoot: () => tempRoot,
      maxTotalBytes: 10,
      ttlMs: 1_000,
      now: () => clock,
    });

    const first = manager.createTempFile("old.txt", "12345678", "utf8");
    expect(fs.existsSync(first.path)).toBe(true);

    // Advance past TTL: next write should automatically evict expired entry and succeed.
    clock += 1_500;
    const second = manager.createTempFile("new.txt", "abcdefgh", "utf8");
    expect(fs.existsSync(first.path)).toBe(false);
    expect(manager.getTempPath(first.tempId)).toBeUndefined();
    expect(fs.readFileSync(second.path, "utf8")).toBe("abcdefgh");
    expect(manager.getTotalBytes()).toBe(8);

    manager.cleanupAll();
  });

  it("cleans up stale orphaned directories left on disk beyond TTL", () => {
    const clock = 10_000_000;
    const tempRoot = path.join(rootDir, "termix");
    fs.mkdirSync(tempRoot, { recursive: true });

    const staleDir = path.join(tempRoot, "stale-orphaned-dir");
    const freshDir = path.join(tempRoot, "fresh-orphaned-dir");
    fs.mkdirSync(staleDir, { recursive: true });
    fs.mkdirSync(freshDir, { recursive: true });

    const staleTime = new Date(clock - 5_000);
    const freshTime = new Date(clock - 100);
    fs.utimesSync(staleDir, staleTime, staleTime);
    fs.utimesSync(freshDir, freshTime, freshTime);

    const manager = createTempFileManager({
      getTempRoot: () => tempRoot,
      ttlMs: 1_000,
      now: () => clock,
    });

    manager.cleanupExpired();

    expect(fs.existsSync(staleDir)).toBe(false);
    expect(fs.existsSync(freshDir)).toBe(true);
  });
});
