import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "./sqlite-adapter.js";

describe("SqliteDatabaseAdapter", () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("opens a persistent sqlite database and creates migration metadata tables", async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "termix-sqlite-adapter-"));
    const dbPath = path.join(tempDir, "termix.sqlite");
    const adapter = new SqliteDatabaseAdapter({
      dialect: "sqlite",
      url: `file:${dbPath}`,
      sqlitePath: dbPath,
    });

    const context = await adapter.connect();
    await adapter.migrate();

    const migrationTable = context.sqlite
      ?.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get("schema_migrations") as { name: string } | undefined;

    expect(context.dialect).toBe("sqlite");
    expect(migrationTable?.name).toBe("schema_migrations");

    await adapter.close();
  });

  it("rejects async sqlite transaction callbacks for now", async () => {
    const adapter = new SqliteDatabaseAdapter({
      dialect: "sqlite",
      url: ":memory:",
      sqlitePath: ":memory:",
    });
    await adapter.connect();

    await expect(adapter.transaction(async () => "done")).rejects.toThrow(
      "must not return a Promise",
    );

    await adapter.close();
  });
});
