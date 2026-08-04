import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATABASE_DIALECT_ENV } from "../../../database/db/dialect.js";

// getDb() throws unless a database was initialized; the context's handle is
// not what this file is about.
vi.mock("../../../database/db/index.js", () => ({
  getDb: () => ({}),
  getSqlite: () => ({}),
  DatabaseSaveTrigger: { forceSave: vi.fn() },
}));

const { createCurrentRepositoryContext, createCurrentRepositoryWriteHook } =
  await import("../../../database/repositories/factory.js");

// Neither cross-dialect harness reaches this function: both
// tests/database/repositories/test-support.ts and scripts/verify-dialects.mjs
// construct a DatabaseContext of their own. That is why the production path
// could report "sqlite" while connected to MySQL with CI green on all three
// engines, and why this asserts on the real factory rather than a fixture.
describe("createCurrentRepositoryContext", () => {
  const saved = process.env[DATABASE_DIALECT_ENV];

  beforeEach(() => {
    delete process.env[DATABASE_DIALECT_ENV];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[DATABASE_DIALECT_ENV];
    else process.env[DATABASE_DIALECT_ENV] = saved;
  });

  it("defaults to sqlite when nothing is configured", () => {
    expect(createCurrentRepositoryContext().dialect).toBe("sqlite");
  });

  it("reports the configured dialect", () => {
    for (const dialect of ["sqlite", "postgres", "mysql"]) {
      process.env[DATABASE_DIALECT_ENV] = dialect;
      expect(createCurrentRepositoryContext().dialect).toBe(dialect);
    }
  });

  it("rejects an unsupported dialect rather than falling back to sqlite", () => {
    process.env[DATABASE_DIALECT_ENV] = "oracle";
    expect(() => createCurrentRepositoryContext()).toThrow(/oracle/);
  });
});

describe("createCurrentRepositoryWriteHook", () => {
  const saved = process.env[DATABASE_DIALECT_ENV];

  afterEach(() => {
    if (saved === undefined) delete process.env[DATABASE_DIALECT_ENV];
    else process.env[DATABASE_DIALECT_ENV] = saved;
  });

  it("installs a persist hook only for sqlite", () => {
    process.env[DATABASE_DIALECT_ENV] = "sqlite";
    expect(createCurrentRepositoryWriteHook("test")).toBeTypeOf("function");

    for (const dialect of ["postgres", "mysql"]) {
      process.env[DATABASE_DIALECT_ENV] = dialect;
      expect(createCurrentRepositoryWriteHook("test")).toBeUndefined();
    }
  });
});
