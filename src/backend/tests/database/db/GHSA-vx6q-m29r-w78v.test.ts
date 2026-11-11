/**
 * A database save that fails reaches the caller that forced it, and a failed
 * write never leaves a cut file behind.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const { DatabaseSaveTrigger } =
  await import("../../../utils/database-save-trigger.js");
const { saveSnapshot, writeFileAtomic } =
  await import("../../../database/db/snapshot-save.js");

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-snapshot-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  DatabaseSaveTrigger.cleanup();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GHSA-vx6q-m29r-w78v snapshot save errors", () => {
  it("rejects a forced save whose write failed and stays dirty", async () => {
    DatabaseSaveTrigger.initialize(() =>
      saveSnapshot({
        serialize: () => Buffer.from("db"),
        encrypted: false,
        write: async () => {
          throw new Error("disk full");
        },
      }),
    );
    DatabaseSaveTrigger.markDirty();

    await expect(DatabaseSaveTrigger.forceSave("test")).rejects.toThrow(
      "disk full",
    );
    expect(DatabaseSaveTrigger.isDirty).toBe(true);
  });

  it("resolves and is clean after a save that landed", async () => {
    const target = path.join(dir, "db.sqlite");
    DatabaseSaveTrigger.initialize(() =>
      saveSnapshot({
        serialize: () => Buffer.from("fresh"),
        encrypted: false,
        write: (buffer) => writeFileAtomic(target, buffer),
      }),
    );
    DatabaseSaveTrigger.markDirty();

    await DatabaseSaveTrigger.forceSave("test");
    expect(DatabaseSaveTrigger.isDirty).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("fresh");
  });

  it("keeps the old file whole when a write fails part way", async () => {
    const target = path.join(dir, "db.sqlite");
    fs.writeFileSync(target, "old contents");
    vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(
      new Error("rename failed"),
    );

    await expect(
      writeFileAtomic(target, Buffer.from("new contents")),
    ).rejects.toThrow("rename failed");
    expect(fs.readFileSync(target, "utf8")).toBe("old contents");
    expect(fs.readdirSync(dir)).toEqual(["db.sqlite"]);
  });
});
