import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

const handles = vi.hoisted(() => ({
  sqlite: null as unknown,
  client: null as unknown,
}));

vi.mock("../../../database/db/index.js", () => ({
  getSqlite: () => handles.sqlite,
  getDb: () => ({ $client: handles.client }),
}));

const { runPluginSql, runPluginSqlBatch } =
  await import("../../../plugins/sandbox/db-exec.js");

beforeEach(() => {
  const db = new Database(":memory:");
  db.exec(
    "create table p_demo_items (id integer primary key, name text, data blob)",
  );
  handles.sqlite = db;
});

describe("sqlite", () => {
  it("runs, reads rows as arrays and reads one row", async () => {
    await runPluginSql(
      "sqlite",
      "insert into p_demo_items (name, data) values (?, ?)",
      ["a", new Uint8Array([1, 2])],
      "run",
    );
    await runPluginSql(
      "sqlite",
      "insert into p_demo_items (name) values (?)",
      [{ nested: true }],
      "run",
    );
    const all = await runPluginSql(
      "sqlite",
      "select id, name from p_demo_items order by id",
      [],
      "all",
    );
    expect(all.rows).toEqual([
      [1, "a"],
      [2, '{"nested":true}'],
    ]);
    expect(
      (
        await runPluginSql(
          "sqlite",
          "select name from p_demo_items where id = ?",
          [1],
          "get",
        )
      ).rows,
    ).toEqual(["a"]);
    expect(
      (
        await runPluginSql(
          "sqlite",
          "select name from p_demo_items where id = ?",
          [99],
          "get",
        )
      ).rows,
    ).toBeUndefined();
  });

  it("turns NaN and undefined into null", async () => {
    await runPluginSql(
      "sqlite",
      "insert into p_demo_items (name) values (?)",
      [Number.NaN],
      "run",
    );
    await runPluginSql(
      "sqlite",
      "insert into p_demo_items (name) values (?)",
      [undefined],
      "run",
    );
    const rows = await runPluginSql(
      "sqlite",
      "select name from p_demo_items",
      [],
      "all",
    );
    expect(rows.rows).toEqual([[null], [null]]);
  });

  it("runs a batch in one transaction, or none of it", async () => {
    await runPluginSqlBatch("sqlite", [
      {
        sql: "insert into p_demo_items (name) values (?)",
        params: ["x"],
        method: "run",
      },
      { sql: "select count(*) from p_demo_items", params: [], method: "all" },
    ]);
    await expect(
      runPluginSqlBatch("sqlite", [
        {
          sql: "insert into p_demo_items (name) values (?)",
          params: ["y"],
          method: "run",
        },
        { sql: "insert into nope values (1)", params: [], method: "run" },
      ]),
    ).rejects.toThrow();
    const rows = await runPluginSql(
      "sqlite",
      "select name from p_demo_items",
      [],
      "all",
    );
    expect(rows.rows).toEqual([["x"]]);
  });
});

describe("postgres", () => {
  it("asks for array rows for all and object rows otherwise", async () => {
    const queries: unknown[] = [];
    handles.client = {
      query: async (q: unknown) => {
        queries.push(q);
        return { rows: [[1]] };
      },
    };
    expect(
      (await runPluginSql("postgres", "select 1", [true], "all")).rows,
    ).toEqual([[1]]);
    await runPluginSql("postgres", "update x set y = 1", [], "execute");
    expect(queries).toEqual([
      { text: "select 1", values: [true], rowMode: "array" },
      { text: "update x set y = 1", values: [] },
    ]);
  });

  it("wraps a batch in BEGIN and COMMIT, and rolls back on failure", async () => {
    const log: unknown[] = [];
    let fail = false;
    const client = {
      query: async (q: unknown) => {
        log.push(typeof q === "string" ? q : (q as { text: string }).text);
        if (fail && (q as { text?: string }).text === "bad")
          throw new Error("boom");
        return { rows: [] };
      },
      release: vi.fn(),
    };
    handles.client = { query: client.query, connect: async () => client };
    await runPluginSqlBatch("postgres", [
      { sql: "ok", params: [], method: "execute" },
    ]);
    expect(log).toEqual(["BEGIN", "ok", "COMMIT"]);
    log.length = 0;
    fail = true;
    await expect(
      runPluginSqlBatch("postgres", [
        { sql: "bad", params: [], method: "execute" },
      ]),
    ).rejects.toThrow("boom");
    expect(log).toEqual(["BEGIN", "bad", "ROLLBACK"]);
    expect(client.release).toHaveBeenCalledTimes(2);
  });
});

describe("mysql", () => {
  it("uses rowsAsArray for all and returns the result header otherwise", async () => {
    const calls: unknown[][] = [];
    const pool = {
      query: async (...args: unknown[]) => {
        calls.push(args);
        return [
          args[0] && typeof args[0] === "object" ? [[1]] : { affectedRows: 1 },
        ];
      },
    };
    handles.client = { promise: () => pool };
    expect((await runPluginSql("mysql", "select 1", [], "all")).rows).toEqual([
      [1],
    ]);
    expect(
      (await runPluginSql("mysql", "update x", [1], "execute")).rows,
    ).toEqual([{ affectedRows: 1 }]);
    expect(calls[0][0]).toEqual({ sql: "select 1", rowsAsArray: true });
  });

  it("commits a batch, rolls back on failure and needs a connection", async () => {
    const steps: string[] = [];
    const connection = {
      query: async (sql: string) => {
        steps.push(sql);
        if (sql === "bad") throw new Error("boom");
        return [{}];
      },
      beginTransaction: async () => void steps.push("begin"),
      commit: async () => void steps.push("commit"),
      rollback: async () => void steps.push("rollback"),
      release: vi.fn(),
    };
    handles.client = {
      query: connection.query,
      getConnection: async () => connection,
    };
    await runPluginSqlBatch("mysql", [
      { sql: "ok", params: [], method: "execute" },
    ]);
    await expect(
      runPluginSqlBatch("mysql", [
        { sql: "bad", params: [], method: "execute" },
      ]),
    ).rejects.toThrow("boom");
    expect(steps).toEqual([
      "begin",
      "ok",
      "commit",
      "begin",
      "bad",
      "rollback",
    ]);
    handles.client = { query: async () => [] };
    await expect(
      runPluginSqlBatch("mysql", [
        { sql: "ok", params: [], method: "execute" },
      ]),
    ).rejects.toThrow("No MySQL connection");
  });
});
