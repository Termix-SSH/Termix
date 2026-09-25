import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { NOTIFICATION_CHANNELS_DDL, pluginDir } from "./helpers";

// The six tables as core's SQLite bootstrap created them before 2.9.0, with
// the indexes performance-indexes.ts added.
const LEGACY_DDL = `
  CREATE TABLE automations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    definition TEXT NOT NULL,
    definition_version INTEGER NOT NULL DEFAULT 1,
    concurrency_policy TEXT NOT NULL DEFAULT 'skip',
    max_run_seconds INTEGER NOT NULL DEFAULT 300,
    dry_run INTEGER NOT NULL DEFAULT 0,
    last_run_at TEXT,
    last_run_status TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE automation_trigger_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    state_key TEXT NOT NULL,
    breach_started_at TEXT,
    last_fired_at TEXT,
    last_value REAL,
    last_observed_state TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE automation_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    cron TEXT,
    interval_seconds INTEGER,
    timezone TEXT,
    next_due_at TEXT,
    last_tick_at TEXT
  );
  CREATE TABLE automation_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trigger_type TEXT NOT NULL,
    trigger_context TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    duration_ms INTEGER,
    error TEXT,
    dry_run INTEGER NOT NULL DEFAULT 0,
    parent_run_id INTEGER
  );
  CREATE TABLE automation_run_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    step_id TEXT NOT NULL,
    step_type TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    output TEXT,
    error TEXT,
    truncated INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE automation_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_automations_user ON automations (user_id, enabled);
  CREATE UNIQUE INDEX idx_automation_trigger_state_key ON automation_trigger_state (automation_id, state_key);
  CREATE UNIQUE INDEX idx_automation_schedules_automation ON automation_schedules (automation_id);
  CREATE INDEX idx_automation_schedules_due ON automation_schedules (next_due_at);
  CREATE INDEX idx_automation_runs_automation ON automation_runs (automation_id, started_at);
  CREATE INDEX idx_automation_runs_user ON automation_runs (user_id, started_at);
  CREATE INDEX idx_automation_run_steps_run ON automation_run_steps (run_id, step_index);
  CREATE UNIQUE INDEX idx_automation_channels_pair ON automation_channels (automation_id, channel_id);
`;

const SEED = `
  INSERT INTO users (id, username) VALUES ('alice', 'alice');
  INSERT INTO notification_channels (id, user_id, name, type, config) VALUES (4, 'alice', 'ops', 'webhook', '{}');
  INSERT INTO automations (id, user_id, name, definition) VALUES (7, 'alice', 'Disk', '{"version":1,"trigger":{"kind":"webhook","tokenHash":"x"},"steps":[]}');
  INSERT INTO automation_trigger_state (automation_id, state_key, last_fired_at) VALUES (7, '1:/data', '2026-01-01T00:00:00Z');
  INSERT INTO automation_schedules (automation_id, interval_seconds, next_due_at) VALUES (7, 300, '2026-01-01T00:05:00Z');
  INSERT INTO automation_runs (id, automation_id, user_id, trigger_type, status) VALUES (3, 7, 'alice', 'manual', 'success');
  INSERT INTO automation_run_steps (run_id, step_index, step_id, step_type, status) VALUES (3, 0, 'a', 'notify', 'success');
  INSERT INTO automation_channels (automation_id, channel_id) VALUES (7, 4);
`;

const ADOPTED = [
  "p_automations_automations",
  "p_automations_trigger_state",
  "p_automations_schedules",
  "p_automations_runs",
  "p_automations_run_steps",
  "p_automations_channels",
];

const LEGACY = [
  "automations",
  "automation_trigger_state",
  "automation_schedules",
  "automation_runs",
  "automation_run_steps",
  "automation_channels",
];

let db: TestDb | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

function tables(target: TestDb): string[] {
  return (
    target.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function indexes(target: TestDb, table: string): string[] {
  return (
    target.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'",
      )
      .all(table) as Array<{ name: string }>
  )
    .map((row) => row.name)
    .sort();
}

const count = (target: TestDb, table: string) =>
  (
    target.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
      n: number;
    }
  ).n;

describe("adopting the automation tables", () => {
  it("keeps every row, index and cascade when the legacy tables exist", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec(NOTIFICATION_CHANNELS_DDL);
        sqlite.exec(LEGACY_DDL);
        sqlite.exec(SEED);
      },
    });

    const names = tables(db);
    for (const table of ADOPTED) expect(names).toContain(table);
    for (const table of LEGACY) expect(names).not.toContain(table);

    for (const table of ADOPTED) expect(count(db, table)).toBe(1);
    expect(
      db.sqlite
        .prepare("SELECT name FROM p_automations_automations WHERE id = 7")
        .get(),
    ).toEqual({ name: "Disk" });

    // Only one copy of each legacy index, never a second one.
    expect(indexes(db, "p_automations_trigger_state")).toEqual([
      "idx_automation_trigger_state_key",
    ]);
    expect(indexes(db, "p_automations_runs")).toEqual([
      "idx_automation_runs_automation",
      "idx_automation_runs_user",
    ]);

    // Channels moved to the alerts plugin, so a link may name a channel the
    // old table never had, and the old one's link is still there.
    expect(indexes(db, "p_automations_channels")).toEqual([
      "idx_automation_channels_pair",
    ]);
    expect(
      db.sqlite.prepare("SELECT channel_id FROM p_automations_channels").all(),
    ).toEqual([{ channel_id: 4 }]);
    db.sqlite
      .prepare(
        "INSERT INTO p_automations_channels (automation_id, channel_id) VALUES (7, 99)",
      )
      .run();
    db.sqlite
      .prepare("DELETE FROM p_automations_channels WHERE channel_id = 99")
      .run();

    // The foreign keys followed the rename: deleting the automation still
    // takes its state, schedule, runs, steps and channel links with it.
    db.sqlite
      .prepare("DELETE FROM p_automations_automations WHERE id = 7")
      .run();
    for (const table of ADOPTED) expect(count(db, table)).toBe(0);
  });

  it("creates the same tables on a fresh install", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => sqlite.exec(NOTIFICATION_CHANNELS_DDL),
    });

    const names = tables(db);
    for (const table of ADOPTED) expect(names).toContain(table);
    for (const table of LEGACY) expect(names).not.toContain(table);
    expect(indexes(db, "p_automations_schedules")).toEqual([
      "idx_automation_schedules_automation",
      "idx_automation_schedules_due",
    ]);

    db.sqlite.exec(`
      INSERT INTO users (id, username) VALUES ('alice', 'alice');
      INSERT INTO p_automations_automations (id, user_id, name, definition) VALUES (1, 'alice', 'A', '{}');
      INSERT INTO p_automations_runs (id, automation_id, user_id, trigger_type, status) VALUES (1, 1, 'alice', 'manual', 'success');
      INSERT INTO p_automations_run_steps (run_id, step_index, step_id, step_type, status) VALUES (1, 0, 'a', 'notify', 'success');
    `);
    // Deleting the user cascades all the way down.
    db.sqlite.prepare("DELETE FROM users WHERE id = 'alice'").run();
    expect(count(db, "p_automations_automations")).toBe(0);
    expect(count(db, "p_automations_run_steps")).toBe(0);
  });
});
