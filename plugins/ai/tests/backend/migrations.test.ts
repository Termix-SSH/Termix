import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { LEGACY_DDL, pluginDir } from "./helpers";

let db: TestDb | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

const tables = (sqlite: TestDb["sqlite"]) =>
  (
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%ai_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);

const indexes = (sqlite: TestDb["sqlite"], table: string) =>
  (
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name LIKE 'idx_%' ORDER BY name",
      )
      .all(table) as Array<{ name: string }>
  ).map((row) => row.name);

describe("ai adoption migration", () => {
  it("renames the legacy tables and keeps every row, index and cascade", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec(LEGACY_DDL);
        sqlite
          .prepare("INSERT INTO users (id, username) VALUES ('u1', 'u1')")
          .run();
        sqlite.exec(`
          INSERT INTO ai_providers (id, user_id, provider_type, label, api_key, api_key_prefix)
            VALUES (3, 'u1', 'ollama', 'Local', 'enc-key', 'abc123');
          INSERT INTO ai_conversations (id, user_id, title) VALUES (5, 'u1', 'Disk');
          INSERT INTO ai_messages (conversation_id, role, content) VALUES (5, 'user', 'why full');
          INSERT INTO ai_proposals (conversation_id, user_id, kind) VALUES (5, 'u1', 'propose_run_command');
        `);
      },
    });

    expect(tables(db.sqlite)).toEqual([
      "p_ai_conversations",
      "p_ai_messages",
      "p_ai_proposals",
      "p_ai_providers",
    ]);

    const provider = db.sqlite
      .prepare("SELECT * FROM p_ai_providers WHERE id = 3")
      .get() as Record<string, unknown>;
    // The key stays until core's boot migration moves it into ctx.secrets.
    expect(provider).toMatchObject({ label: "Local", api_key: "enc-key" });

    expect(indexes(db.sqlite, "p_ai_providers")).toEqual([
      "idx_ai_providers_user_label",
    ]);
    expect(indexes(db.sqlite, "p_ai_proposals")).toEqual([
      "idx_ai_proposals_conversation",
      "idx_ai_proposals_user",
    ]);

    // The rename carried the foreign keys: a conversation still takes its
    // messages and proposals with it.
    db.sqlite.prepare("DELETE FROM p_ai_conversations WHERE id = 5").run();
    const count = (table: string) =>
      (
        db!.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
          n: number;
        }
      ).n;
    expect(count("p_ai_messages")).toBe(0);
    expect(count("p_ai_proposals")).toBe(0);
  });

  it("creates fresh tables when there is nothing to adopt", async () => {
    db = await createTestDb(pluginDir);

    expect(tables(db.sqlite)).toEqual([
      "p_ai_conversations",
      "p_ai_messages",
      "p_ai_proposals",
      "p_ai_providers",
    ]);
    const columns = (
      db.sqlite.prepare("PRAGMA table_info(p_ai_providers)").all() as Array<{
        name: string;
      }>
    ).map((column) => column.name);
    expect(columns).not.toContain("api_key");

    db.sqlite
      .prepare("INSERT INTO users (id, username) VALUES ('u1', 'u1')")
      .run();
    db.sqlite
      .prepare("INSERT INTO p_ai_conversations (id, user_id) VALUES (1, 'u1')")
      .run();
    db.sqlite
      .prepare(
        "INSERT INTO p_ai_messages (conversation_id, role) VALUES (1, 'user')",
      )
      .run();
    db.sqlite.prepare("DELETE FROM p_ai_conversations WHERE id = 1").run();
    expect(
      (
        db.sqlite.prepare("SELECT COUNT(*) AS n FROM p_ai_messages").get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
  });
});
