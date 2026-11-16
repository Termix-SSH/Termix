import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { syncIdIndexStatements } from "../../../database/db/sync-id-index.js";

function table(embedded: boolean, name = "ssh_data") {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE ${name} (id INTEGER PRIMARY KEY, user_id TEXT, sync_id TEXT)`);
  // Every existing install has the old global index.
  db.exec(`CREATE UNIQUE INDEX idx_${name}_sync_id ON ${name}(sync_id)`);
  for (const statement of syncIdIndexStatements(name, embedded)) {
    db.exec(statement);
  }
  const insert = db.prepare(
    `INSERT INTO ${name} (user_id, sync_id) VALUES (?, ?)`,
  );
  return { insert: (user: string, syncId: string) => insert.run(user, syncId) };
}

describe("syncIdIndexStatements", () => {
  it("lets two desktop accounts hold a copy of the same host", () => {
    const { insert } = table(true);
    insert("owner", "host-1");
    expect(() => insert("recipient", "host-1")).not.toThrow();
    expect(() => insert("recipient", "host-1")).toThrow(/UNIQUE/);
  });

  it("does the same for logins on the desktop", () => {
    const { insert } = table(true, "ssh_credentials");
    insert("owner", "cred-1");
    expect(() => insert("recipient", "cred-1")).not.toThrow();
  });

  it("keeps sync ids unique across users on a server", () => {
    const { insert } = table(false);
    insert("owner", "host-1");
    expect(() => insert("someone-else", "host-1")).toThrow(/UNIQUE/);
  });

  it("keeps folders unique on the desktop too", () => {
    const { insert } = table(true, "ssh_folders");
    insert("owner", "folder-1");
    expect(() => insert("recipient", "folder-1")).toThrow(/UNIQUE/);
  });
});
