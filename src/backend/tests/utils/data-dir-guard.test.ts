import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  ALLOW_EMPTY_DATA_DIR_ENV,
  assertDataDirIsNotMisconfigured,
  DataDirMisconfiguredError,
  findDatabaseOutsideDataDir,
} from "../../utils/data-dir-guard.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-datadir-"));
  tempDirs.push(dir);
  return dir;
}

/** Writes a plain (unencrypted) database file into `dir`. */
function writePlainDatabase(dir: string, size = 4096): string {
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "db.sqlite");
  fs.writeFileSync(dbPath, Buffer.alloc(size, 1));
  return dbPath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("findDatabaseOutsideDataDir", () => {
  it("returns null on a genuinely fresh install", () => {
    const cwd = makeTempDir();
    const dataDir = path.join(cwd, "db", "data");

    expect(findDatabaseOutsideDataDir(dataDir, cwd)).toBeNull();
  });

  it("finds a database left in the legacy data directory", () => {
    const cwd = makeTempDir();
    const legacyDir = path.join(cwd, "data");
    writePlainDatabase(legacyDir);

    expect(findDatabaseOutsideDataDir(path.join(cwd, "db", "data"), cwd)).toBe(
      legacyDir,
    );
  });

  it("finds a database under the default directory when DATA_DIR points elsewhere", () => {
    const cwd = makeTempDir();
    const defaultDir = path.join(cwd, "db", "data");
    writePlainDatabase(defaultDir);

    expect(findDatabaseOutsideDataDir("/mnt/unmounted-volume", cwd)).toBe(
      defaultDir,
    );
  });

  it("ignores the configured data directory itself", () => {
    const cwd = makeTempDir();
    const dataDir = path.join(cwd, "data");
    writePlainDatabase(dataDir);

    expect(findDatabaseOutsideDataDir(dataDir, cwd)).toBeNull();
  });

  it("ignores a zero-length database file", () => {
    const cwd = makeTempDir();
    writePlainDatabase(path.join(cwd, "data"), 0);

    expect(findDatabaseOutsideDataDir(path.join(cwd, "db", "data"), cwd)).toBe(
      null,
    );
  });
});

describe("assertDataDirIsNotMisconfigured", () => {
  it("passes when no database exists anywhere else", () => {
    const cwd = makeTempDir();

    expect(() =>
      assertDataDirIsNotMisconfigured(path.join(cwd, "db", "data"), {}, cwd),
    ).not.toThrow();
  });

  it("refuses to start and names both directories", () => {
    const cwd = makeTempDir();
    const legacyDir = path.join(cwd, "data");
    writePlainDatabase(legacyDir);
    const dataDir = path.join(cwd, "db", "data");

    expect(() => assertDataDirIsNotMisconfigured(dataDir, {}, cwd)).toThrow(
      DataDirMisconfiguredError,
    );
    // Matched as substrings, not patterns: Windows paths are full of
    // backslash sequences a RegExp would read as escapes.
    expect(() => assertDataDirIsNotMisconfigured(dataDir, {}, cwd)).toThrow(
      legacyDir,
    );
    expect(() => assertDataDirIsNotMisconfigured(dataDir, {}, cwd)).toThrow(
      dataDir,
    );
  });

  it("can be overridden to start with a new database", () => {
    const cwd = makeTempDir();
    writePlainDatabase(path.join(cwd, "data"));

    for (const value of ["true", "1", "YES", "on"]) {
      expect(() =>
        assertDataDirIsNotMisconfigured(
          path.join(cwd, "db", "data"),
          { [ALLOW_EMPTY_DATA_DIR_ENV]: value },
          cwd,
        ),
      ).not.toThrow();
    }
  });

  it("still refuses when the override is not a truthy value", () => {
    const cwd = makeTempDir();
    writePlainDatabase(path.join(cwd, "data"));

    expect(() =>
      assertDataDirIsNotMisconfigured(
        path.join(cwd, "db", "data"),
        { [ALLOW_EMPTY_DATA_DIR_ENV]: "false" },
        cwd,
      ),
    ).toThrow(DataDirMisconfiguredError);
  });
});
