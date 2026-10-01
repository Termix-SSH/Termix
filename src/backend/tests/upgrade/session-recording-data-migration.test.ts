/**
 * The 2.8 session recording move. The retention period survives, so the
 * plugin's first sweep does not prune with its own default, and each 2.8
 * recording file moves into the plugin's folder with its row following it.
 * Running it twice changes nothing.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  db: null as unknown,
  core: new Map<string, string>(),
  plugin: new Map<string, string>(),
  installed: true,
}));

vi.mock("../../database/db/index.js", () => ({ getDb: () => h.db }));
vi.mock("../../utils/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { databaseLogger: log };
});
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) => (h.installed ? { id } : null),
  }),
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => h.core.get(key) ?? null,
  }),
  createCurrentPluginSettingsRepository: () => ({
    get: async (_p: string, _s: string, _id: string | null, key: string) =>
      h.plugin.has(key) ? { value: h.plugin.get(key) } : null,
    set: async (
      _p: string,
      _s: string,
      _id: string | null,
      key: string,
      value: string,
    ) => {
      h.plugin.set(key, value);
    },
  }),
}));

const { runSessionRecordingDataMigration } =
  await import("../../upgrade/session-recording-data-migration.js");

let dataDir: string;
let sqlite: Database.Database;

function write(relative: string, content: string): string {
  const file = path.join(dataDir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function paths(): Record<number, string> {
  return Object.fromEntries(
    (
      sqlite
        .prepare(
          "SELECT id, recording_path FROM p_session_recording_session_recordings",
        )
        .all() as Array<{ id: number; recording_path: string }>
    ).map((row) => [row.id, row.recording_path]),
  );
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "recording-move-"));
  vi.stubEnv("DATA_DIR", dataDir);
  vi.stubEnv("SESSION_RECORDING_RETENTION_DAYS", "");
  h.core.clear();
  h.plugin.clear();
  h.installed = true;
  sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE p_session_recording_session_recordings (
    id INTEGER PRIMARY KEY, recording_path TEXT
  )`);
  h.db = drizzle(sqlite);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("runSessionRecordingDataMigration", () => {
  it("moves each 2.8 recording into the plugin's folder and points its row there", async () => {
    const ssh = write("session_logs/user-1/s1.cast", "ssh");
    const rdp = write("session_recordings/guacamole/r1.guac", "rdp");
    const insert = sqlite.prepare(
      "INSERT INTO p_session_recording_session_recordings (id, recording_path) VALUES (?, ?)",
    );
    insert.run(1, ssh);
    insert.run(2, rdp);
    insert.run(3, path.join(dataDir, "session_logs/user-1/gone.cast"));
    insert.run(4, "/somewhere/else.cast");

    const result = await runSessionRecordingDataMigration();

    const base = path.join(dataDir, "plugin-data", "session-recording");
    const moved = paths();
    expect(moved[1]).toBe(path.join(base, "session_logs/user-1/s1.cast"));
    expect(moved[2]).toBe(
      path.join(base, "session_recordings/guacamole/r1.guac"),
    );
    expect(fs.readFileSync(moved[1], "utf8")).toBe("ssh");
    expect(fs.readFileSync(moved[2], "utf8")).toBe("rdp");
    expect(fs.existsSync(ssh)).toBe(false);
    // A file 2.8 had already lost, and a path outside 2.8's folders, stay put.
    expect(moved[3]).toBe(path.join(dataDir, "session_logs/user-1/gone.cast"));
    expect(moved[4]).toBe("/somewhere/else.cast");
    expect(result.moved).toBe(2);

    const again = await runSessionRecordingDataMigration();
    expect(again.moved).toBe(0);
    expect(paths()).toEqual(moved);
  });

  it("keeps the 2.8 retention period", async () => {
    h.core.set("session_recording_retention_days", "365");
    await runSessionRecordingDataMigration();
    expect(h.plugin.get("retentionDays")).toBe("365");

    h.core.set("session_recording_retention_days", "90");
    await runSessionRecordingDataMigration();
    expect(h.plugin.get("retentionDays")).toBe("365");
  });

  it("falls back to the environment variable 2.8 read", async () => {
    vi.stubEnv("SESSION_RECORDING_RETENTION_DAYS", "120");
    await runSessionRecordingDataMigration();
    expect(h.plugin.get("retentionDays")).toBe("120");
  });

  it("does nothing until the plugin is installed", async () => {
    h.installed = false;
    h.core.set("session_recording_retention_days", "365");
    const ssh = write("session_logs/user-1/s1.cast", "ssh");
    sqlite
      .prepare(
        "INSERT INTO p_session_recording_session_recordings (id, recording_path) VALUES (1, ?)",
      )
      .run(ssh);

    await runSessionRecordingDataMigration();

    expect(h.plugin.size).toBe(0);
    expect(paths()[1]).toBe(ssh);
  });
});
