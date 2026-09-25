/**
 * The 2.8 to 2.9 channel move. Every notification channel reaches the alerts
 * plugin's table with its id, its config sealed with the installation key once
 * the owner's data key opens, and nothing left readable in the old table.
 * A closed or wrong key leaves the config as it was, and a later run for that
 * user finishes the job. Running it twice changes nothing.
 */

import crypto from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FieldCrypto } from "../../utils/field-crypto.js";

const h = vi.hoisted(() => ({
  db: null as unknown,
  deks: new Map<string, Buffer>(),
}));

vi.mock("../../database/db/index.js", () => ({ getDb: () => h.db }));
vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: { getUserDataKey: (userId: string) => h.deks.get(userId) },
}));
vi.mock("../../utils/system-secret-crypto.js", () => ({
  encryptSystemSecret: async (value: string) => `sysenc:v1:${value}`,
  isSystemEncrypted: (value: string) => value.startsWith("sysenc:v1:"),
}));
vi.mock("../../utils/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { databaseLogger: log };
});

const { runNotificationChannelMigration } =
  await import("../../upgrade/notification-channel-migration.js");

let sqlite: Database.Database;

const SOURCE_DDL = `
  CREATE TABLE notification_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

const TARGET_DDL = `
  CREATE TABLE "p_alerts_channels" (
    "id" integer PRIMARY KEY AUTOINCREMENT,
    "user_id" text NOT NULL,
    "name" text NOT NULL,
    "type" text NOT NULL,
    "config" text,
    "enabled" integer NOT NULL DEFAULT 1,
    "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

function setup({ target }: { target: boolean }) {
  sqlite = new Database(":memory:");
  sqlite.exec(SOURCE_DDL);
  if (target) sqlite.exec(TARGET_DDL);
  h.db = drizzle(sqlite);
  h.deks.clear();
}

function addChannel(
  id: number,
  userId: string,
  config: Record<string, unknown>,
  options: { encrypt?: boolean; enabled?: boolean } = {},
) {
  let dek = h.deks.get(userId);
  if (!dek) {
    dek = crypto.randomBytes(32);
    h.deks.set(userId, dek);
  }
  const text = JSON.stringify(config);
  const stored =
    options.encrypt === false
      ? text
      : FieldCrypto.encryptField(text, dek, String(id), "config");
  sqlite
    .prepare(
      "INSERT INTO notification_channels (id, user_id, name, type, config, enabled) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      userId,
      `channel-${id}`,
      "ntfy",
      stored,
      options.enabled === false ? 0 : 1,
    );
}

const targetRows = () =>
  sqlite
    .prepare(
      'SELECT id, user_id, name, type, config, enabled FROM "p_alerts_channels" ORDER BY id',
    )
    .all() as Array<{
    id: number;
    user_id: string;
    name: string;
    type: string;
    config: string;
    enabled: number;
  }>;

const sealed = (config: Record<string, unknown>) =>
  `sysenc:v1:${JSON.stringify(config)}`;

describe("runNotificationChannelMigration", () => {
  beforeEach(() => setup({ target: true }));

  it("does nothing until the plugin's table exists", async () => {
    setup({ target: false });
    addChannel(1, "alice", { url: "https://ntfy.sh", topic: "a" });
    expect(await runNotificationChannelMigration()).toEqual({
      moved: 0,
      sealed: 0,
    });
  });

  it("copies every channel with its id and seals its config", async () => {
    addChannel(4, "alice", { url: "https://ntfy.sh", topic: "a", token: "tk" });
    addChannel(7, "bob", { url: "https://hooks.example" }, { enabled: false });

    expect(await runNotificationChannelMigration()).toEqual({
      moved: 2,
      sealed: 2,
    });

    expect(targetRows()).toEqual([
      {
        id: 4,
        user_id: "alice",
        name: "channel-4",
        type: "ntfy",
        config: sealed({ url: "https://ntfy.sh", topic: "a", token: "tk" }),
        enabled: 1,
      },
      {
        id: 7,
        user_id: "bob",
        name: "channel-7",
        type: "ntfy",
        config: sealed({ url: "https://hooks.example" }),
        enabled: 0,
      },
    ]);
    // No token is left readable in the old table.
    expect(
      sqlite.prepare("SELECT config FROM notification_channels").all(),
    ).toEqual([{ config: "" }, { config: "" }]);
  });

  it("seals a config 2.8 never encrypted", async () => {
    addChannel(
      2,
      "alice",
      { url: "https://ntfy.sh", topic: "p" },
      {
        encrypt: false,
      },
    );
    await runNotificationChannelMigration();
    expect(targetRows()[0].config).toBe(
      sealed({ url: "https://ntfy.sh", topic: "p" }),
    );
  });

  it("waits for a closed key, then seals at that user's login", async () => {
    addChannel(3, "carol", { url: "https://ntfy.sh", topic: "c" });
    const dek = h.deks.get("carol")!;
    h.deks.delete("carol");

    expect(await runNotificationChannelMigration()).toEqual({
      moved: 1,
      sealed: 0,
    });
    const raw = targetRows()[0].config;
    expect(raw.startsWith("sysenc:")).toBe(false);
    expect(FieldCrypto.isEncrypted(raw)).toBe(true);

    h.deks.set("carol", dek);
    expect(await runNotificationChannelMigration("carol")).toEqual({
      moved: 0,
      sealed: 1,
    });
    expect(targetRows()[0].config).toBe(
      sealed({ url: "https://ntfy.sh", topic: "c" }),
    );
  });

  it("leaves a config the key cannot open as it was", async () => {
    addChannel(5, "dave", { url: "https://ntfy.sh", topic: "d" });
    h.deks.set("dave", crypto.randomBytes(32));

    await runNotificationChannelMigration();

    const raw = targetRows()[0].config;
    expect(raw.startsWith("sysenc:")).toBe(false);
    expect(FieldCrypto.isEncrypted(raw)).toBe(true);
  });

  it("changes nothing the second time", async () => {
    addChannel(1, "alice", { url: "https://ntfy.sh", topic: "a" });
    await runNotificationChannelMigration();
    const first = targetRows();

    expect(await runNotificationChannelMigration()).toEqual({
      moved: 0,
      sealed: 0,
    });
    expect(targetRows()).toEqual(first);
  });
});
