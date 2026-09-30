/**
 * The SSH connection options moving out of ssh_data.terminal_config into
 * the core ssh_options column, against a real SQLite database through the
 * same raw SQL helpers the boot path uses.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../../../database/db/index.js", () => ({ getDb: () => state.db }));
vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn() },
}));

const { runSshOptionsMigration } =
  await import("../../../utils/crypto-migration/ssh-options-migration.js");

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE ssh_data (
      id INTEGER PRIMARY KEY,
      terminal_config TEXT,
      ssh_options TEXT
    );
  `);
  state.db = drizzle(sqlite);
});

function insert(id: number, terminalConfig: unknown, sshOptions?: string) {
  sqlite
    .prepare(
      "INSERT INTO ssh_data (id, terminal_config, ssh_options) VALUES (?, ?, ?)",
    )
    .run(
      id,
      terminalConfig === null ? null : JSON.stringify(terminalConfig),
      sshOptions ?? null,
    );
}

function options(id: number): unknown {
  const row = sqlite
    .prepare("SELECT ssh_options FROM ssh_data WHERE id = ?")
    .get(id) as { ssh_options: string | null };
  return row.ssh_options === null ? null : JSON.parse(row.ssh_options);
}

describe("runSshOptionsMigration", () => {
  it("copies only the connection options, leaving the look and old tunnel keys", async () => {
    insert(1, {
      theme: "dracula",
      fontSize: 16,
      keepaliveInterval: 30,
      keepaliveCountMax: 3,
      allowLegacyAlgorithms: false,
      agentSocketPath: "/run/agent.sock",
      agentIdentity: "work",
      agentForwarding: true,
      environmentVariables: [{ key: "LANG", value: "C" }],
      startupSnippetId: 4,
      cfAccessClientId: "old",
      cfTunnelHostname: "old.example.com",
    });

    const result = await runSshOptionsMigration();

    expect(result.hostsMoved).toBe(1);
    expect(options(1)).toEqual({
      keepaliveInterval: 30,
      keepaliveCountMax: 3,
      allowLegacyAlgorithms: false,
      agentSocketPath: "/run/agent.sock",
      agentIdentity: "work",
      agentForwarding: true,
      environmentVariables: [{ key: "LANG", value: "C" }],
    });
    const terminalConfig = sqlite
      .prepare("SELECT terminal_config FROM ssh_data WHERE id = 1")
      .get() as { terminal_config: string };
    expect(JSON.parse(terminalConfig.terminal_config).keepaliveInterval).toBe(
      30,
    );
  });

  it("marks a host with no options as done and skips hosts with no config", async () => {
    insert(1, { theme: "dracula" });
    insert(2, null);

    const result = await runSshOptionsMigration();

    expect(result.hostsMoved).toBe(0);
    expect(options(1)).toEqual({});
    expect(options(2)).toBeNull();
  });

  it("changes nothing on a second run, even after the options were edited", async () => {
    insert(1, { keepaliveInterval: 30 });
    insert(
      2,
      { keepaliveInterval: 45 },
      JSON.stringify({ keepaliveCountMax: 9 }),
    );
    await runSshOptionsMigration();

    sqlite
      .prepare("UPDATE ssh_data SET ssh_options = ? WHERE id = 1")
      .run(JSON.stringify({ keepaliveInterval: 90 }));
    const second = await runSshOptionsMigration();

    expect(second.hostsMoved).toBe(0);
    expect(options(1)).toEqual({ keepaliveInterval: 90 });
    expect(options(2)).toEqual({ keepaliveCountMax: 9 });
  });

  it("does not throw on a database without the column", async () => {
    sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE ssh_data (id INTEGER PRIMARY KEY)");
    state.db = drizzle(sqlite);
    await expect(runSshOptionsMigration()).resolves.toEqual({
      hostsMoved: 0,
    });
  });
});
