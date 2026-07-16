import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  DATABASE_LAYER_PREUPGRADE_BACKUP_MARKER,
  DATABASE_LAYER_PREUPGRADE_BACKUP_PREFIX,
  DATABASE_LAYER_SKIP_PREUPGRADE_BACKUP_ENV,
  ensureDatabaseLayerPreupgradeBackup,
} from "./database-layer-preupgrade-backup.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-prebackup-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("ensureDatabaseLayerPreupgradeBackup", () => {
  it("copies existing database files and writes a marker", () => {
    const dataDir = makeTempDir();
    const encryptedDbPath = path.join(dataDir, "db.sqlite.encrypted");
    const metadataPath = `${encryptedDbPath}.meta`;
    const envPath = path.join(dataDir, ".env");
    fs.writeFileSync(encryptedDbPath, "encrypted-db");
    fs.writeFileSync(metadataPath, '{"version":"v2"}');
    fs.writeFileSync(envPath, "DATABASE_KEY=test-key");

    const result = ensureDatabaseLayerPreupgradeBackup({
      dataDir,
      version: "2.5.0-test",
      now: new Date("2026-06-27T12:00:00.000Z"),
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.status).toBe("created");
    expect(result.backupDir).toContain(DATABASE_LAYER_PREUPGRADE_BACKUP_PREFIX);
    expect(
      fs.existsSync(
        path.join(dataDir, DATABASE_LAYER_PREUPGRADE_BACKUP_MARKER),
      ),
    ).toBe(true);
    expect(
      fs.readFileSync(
        path.join(result.backupDir!, "db.sqlite.encrypted"),
        "utf8",
      ),
    ).toBe("encrypted-db");
    expect(
      fs.readFileSync(
        path.join(result.backupDir!, "db.sqlite.encrypted.meta"),
        "utf8",
      ),
    ).toBe('{"version":"v2"}');
    expect(fs.readFileSync(path.join(result.backupDir!, ".env"), "utf8")).toBe(
      "DATABASE_KEY=test-key",
    );

    const manifest = JSON.parse(
      fs.readFileSync(path.join(result.backupDir!, "manifest.json"), "utf8"),
    ) as { sourceVersion: string };
    expect(manifest.sourceVersion).toBe("2.5.0-test");
  });

  it("skips when the marker already exists", () => {
    const dataDir = makeTempDir();
    fs.writeFileSync(path.join(dataDir, "db.sqlite.encrypted"), "encrypted-db");
    fs.writeFileSync(
      path.join(dataDir, DATABASE_LAYER_PREUPGRADE_BACKUP_MARKER),
      "{}",
    );

    const result = ensureDatabaseLayerPreupgradeBackup({
      dataDir,
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "marker_exists",
    });
    expect(fs.existsSync(path.join(dataDir, "backups"))).toBe(false);
  });

  it("skips new installs without a database file", () => {
    const dataDir = makeTempDir();

    const result = ensureDatabaseLayerPreupgradeBackup({
      dataDir,
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "no_database_file",
    });
    expect(
      fs.existsSync(
        path.join(dataDir, DATABASE_LAYER_PREUPGRADE_BACKUP_MARKER),
      ),
    ).toBe(false);
  });

  it("honors the explicit skip environment variable", () => {
    const dataDir = makeTempDir();
    fs.writeFileSync(path.join(dataDir, "db.sqlite.encrypted"), "encrypted-db");

    const result = ensureDatabaseLayerPreupgradeBackup({
      dataDir,
      env: {
        [DATABASE_LAYER_SKIP_PREUPGRADE_BACKUP_ENV]: "1",
      } as NodeJS.ProcessEnv,
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "skip_env",
    });
    expect(fs.existsSync(path.join(dataDir, "backups"))).toBe(false);
  });

  it("fails closed when the backup cannot be written", () => {
    const dataDir = makeTempDir();
    fs.writeFileSync(path.join(dataDir, "db.sqlite.encrypted"), "encrypted-db");
    fs.writeFileSync(path.join(dataDir, "backups"), "not-a-directory");

    expect(() =>
      ensureDatabaseLayerPreupgradeBackup({
        dataDir,
        env: {} as NodeJS.ProcessEnv,
      }),
    ).toThrow("Failed to create database layer pre-upgrade backup");
  });
});
