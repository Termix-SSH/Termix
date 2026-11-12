import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveRestorePaths } from "../../database/restore-paths.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-restore-test-"));
const dataDir = path.join(root, "data");
const outside = path.join(root, "outside");
fs.mkdirSync(dataDir);
fs.mkdirSync(outside);
fs.writeFileSync(path.join(dataDir, "backup.sqlite.encrypted"), "x");
fs.writeFileSync(path.join(outside, "other.sqlite.encrypted"), "x");

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("database restore paths", () => {
  it("accepts a backup and target inside the data folder", () => {
    const paths = resolveRestorePaths(
      dataDir,
      "backup.sqlite.encrypted",
      "restored.sqlite",
    );
    expect(paths).not.toBeNull();
    const base = fs.realpathSync(dataDir);
    expect(paths!.backupPath).toBe(path.join(base, "backup.sqlite.encrypted"));
    expect(paths!.targetPath).toBe(path.join(base, "restored.sqlite"));
  });

  it("leaves the target out when none is given", () => {
    const paths = resolveRestorePaths(dataDir, "backup.sqlite.encrypted", "");
    expect(paths?.targetPath).toBeUndefined();
  });

  it.each([
    ["../outside/other.sqlite.encrypted", undefined],
    [path.join(outside, "other.sqlite.encrypted"), undefined],
    ["backup.sqlite.encrypted", "../outside/pwn"],
    ["backup.sqlite.encrypted", path.join(outside, "pwn")],
    ["backup.sqlite.encrypted", "."],
    ["", undefined],
    [{ path: "x" }, undefined],
    ["backup.sqlite.encrypted", 5],
  ])("refuses backup %j with target %j", (backup, target) => {
    expect(resolveRestorePaths(dataDir, backup, target)).toBeNull();
  });

  it("follows symlinks before checking", () => {
    const link = path.join(dataDir, "link");
    try {
      fs.symlinkSync(outside, link, "junction");
    } catch {
      return;
    }
    expect(
      resolveRestorePaths(dataDir, "link/other.sqlite.encrypted", undefined),
    ).toBeNull();
    expect(
      resolveRestorePaths(dataDir, "backup.sqlite.encrypted", "link/pwn"),
    ).toBeNull();
  });

  it("is used by the restore route", () => {
    const source = fs.readFileSync(
      new URL("../../database/database.ts", import.meta.url),
      "utf8",
    );
    const route = source.slice(source.indexOf('"/database/restore"'));
    expect(route.slice(0, 800)).toContain("resolveRestorePaths(");
  });
});
