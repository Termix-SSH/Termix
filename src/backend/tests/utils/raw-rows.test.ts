import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const db = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("../../database/db/index.js", () => ({
  getDb: () => db.current,
}));

const { selectRows, runStatement } =
  await import("../../utils/crypto-migration/raw-rows.js");

describe("raw-rows", () => {
  beforeEach(() => {
    db.current = {};
  });

  it("uses all() and run() on SQLite", async () => {
    const run = vi.fn();
    db.current = { all: async () => [{ id: 1 }], run };
    await expect(selectRows(sql`SELECT 1`)).resolves.toEqual([{ id: 1 }]);
    await runStatement(sql`UPDATE x SET y = 1`);
    expect(run).toHaveBeenCalledOnce();
  });

  it("reads rows from node-postgres's { rows }", async () => {
    db.current = { execute: async () => ({ rows: [{ id: 2 }] }) };
    await expect(selectRows(sql`SELECT 1`)).resolves.toEqual([{ id: 2 }]);
  });

  it("reads rows from mysql2's [rows, fields]", async () => {
    const execute = vi.fn(async () => [[{ id: 3 }], []]);
    db.current = { execute };
    await expect(selectRows(sql`SELECT 1`)).resolves.toEqual([{ id: 3 }]);
    await runStatement(sql`UPDATE x SET y = 1`);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
