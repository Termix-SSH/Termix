import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  guardMysqlPool,
  guardPgPool,
  nanToNull,
} from "../../../database/db/nan-params.js";

describe("nanToNull", () => {
  it("binds NaN as null and leaves everything else", () => {
    expect(nanToNull([1, Number.NaN, "x", null, 0])).toEqual([
      1,
      null,
      "x",
      null,
      0,
    ]);
    expect(nanToNull(undefined)).toBeUndefined();
  });
});

function fakePool() {
  const pool = new EventEmitter() as EventEmitter & {
    query: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };
  pool.query = vi.fn();
  pool.execute = vi.fn();
  return pool;
}

describe("guardPgPool", () => {
  it("fixes values passed as an array or in a query config", () => {
    const pool = fakePool();
    const query = pool.query;
    guardPgPool(pool);
    pool.query("select $1", [Number.NaN]);
    expect(query).toHaveBeenLastCalledWith("select $1", [null]);
    pool.query({ text: "select $1", values: [Number.NaN, 2] });
    expect(query).toHaveBeenLastCalledWith({
      text: "select $1",
      values: [null, 2],
    });
  });

  it("guards clients handed out for transactions", () => {
    const pool = fakePool();
    guardPgPool(pool);
    const client = { query: vi.fn() };
    const original = client.query;
    pool.emit("connect", client);
    client.query("select $1", [Number.NaN]);
    expect(original).toHaveBeenLastCalledWith("select $1", [null]);
  });
});

describe("guardMysqlPool", () => {
  it("fixes query and execute on the pool and its connections", () => {
    const pool = fakePool();
    const execute = pool.execute;
    guardMysqlPool(pool);
    pool.execute("select ?", [Number.NaN]);
    expect(execute).toHaveBeenLastCalledWith("select ?", [null]);
    const connection = { query: vi.fn(), execute: vi.fn() };
    const query = connection.query;
    pool.emit("connection", connection);
    connection.query({ sql: "select ?" }, [Number.NaN]);
    expect(query).toHaveBeenLastCalledWith({ sql: "select ?" }, [null]);
  });
});

describe("driver query objects", () => {
  it("passes a class instance through untouched", () => {
    const pool = fakePool();
    const query = pool.query;
    guardPgPool(pool);
    class Query {
      values = [Number.NaN];
    }
    const q = new Query();
    pool.query(q);
    expect(query.mock.calls.at(-1)?.[0]).toBe(q);
  });
});
