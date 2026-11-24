import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const migratorMocks = vi.hoisted(() => ({
  pgMigrate: vi.fn(),
  mysqlMigrate: vi.fn(),
  pgDrizzle: vi.fn((opts: { client: unknown }) => ({ __pgConn: opts.client })),
  mysqlDrizzle: vi.fn((opts: { client: unknown }) => ({
    __mysqlConn: opts.client,
  })),
}));

vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: migratorMocks.pgMigrate,
}));
vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: migratorMocks.pgDrizzle,
}));
vi.mock("drizzle-orm/mysql2/migrator", () => ({
  migrate: migratorMocks.mysqlMigrate,
}));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: migratorMocks.mysqlDrizzle,
}));

const {
  migrationsFolder,
  runRemoteMigrations,
  MIGRATIONS_DIR_ENV,
  PG_MIGRATION_LOCK_KEY,
  MYSQL_MIGRATION_LOCK_NAME,
  MYSQL_MIGRATION_LOCK_TIMEOUT_SEC,
} = await import("../../../database/db/migrate.js");

beforeEach(() => {
  migratorMocks.pgMigrate.mockReset().mockResolvedValue(undefined);
  migratorMocks.mysqlMigrate.mockReset().mockResolvedValue(undefined);
  migratorMocks.pgDrizzle.mockClear();
  migratorMocks.mysqlDrizzle.mockClear();
});

describe("migrationsFolder", () => {
  it("gives each engine its own folder", () => {
    // The generated SQL differs per dialect, so they cannot share one.
    expect(migrationsFolder("postgres", {})).toBe(
      path.resolve(process.cwd(), "drizzle", "postgres"),
    );
    expect(migrationsFolder("mysql", {})).toBe(
      path.resolve(process.cwd(), "drizzle", "mysql"),
    );
  });

  it("honours an explicit root", () => {
    expect(
      migrationsFolder("postgres", { [MIGRATIONS_DIR_ENV]: "/srv/migrations" }),
    ).toBe(path.join("/srv/migrations", "postgres"));
  });

  it("ignores a blank override", () => {
    expect(migrationsFolder("mysql", { [MIGRATIONS_DIR_ENV]: "  " })).toBe(
      path.resolve(process.cwd(), "drizzle", "mysql"),
    );
  });
});

describe("runRemoteMigrations", () => {
  it("refuses sqlite, which builds its schema elsewhere", () => {
    return expect(
      runRemoteMigrations("sqlite", {} as never),
    ).rejects.toThrow(/SQLite builds its schema in index.ts/);
  });

  it("acquires and releases a PostgreSQL advisory lock on a dedicated pool connection", async () => {
    const events: string[] = [];
    const conn = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        events.push(`${text}:${JSON.stringify(values)}`);
      }),
      release: vi.fn(() => {
        events.push("release");
      }),
    };
    migratorMocks.pgMigrate.mockImplementationOnce(async () => {
      events.push("migrate");
    });

    const db = { $client: { connect: vi.fn(async () => conn) } };
    await runRemoteMigrations("postgres", db as never, {});

    expect(events).toEqual([
      `SELECT pg_advisory_lock($1):[${PG_MIGRATION_LOCK_KEY}]`,
      "migrate",
      `SELECT pg_advisory_unlock($1):[${PG_MIGRATION_LOCK_KEY}]`,
      "release",
    ]);
  });

  it("releases the PostgreSQL advisory lock and connection even when migrate throws", async () => {
    const conn = {
      query: vi.fn(async () => {}),
      release: vi.fn(),
    };
    migratorMocks.pgMigrate.mockRejectedValueOnce(new Error("ddl failed"));

    const db = { $client: { connect: vi.fn(async () => conn) } };
    await expect(
      runRemoteMigrations("postgres", db as never, {}),
    ).rejects.toThrow("ddl failed");

    expect(conn.query).toHaveBeenNthCalledWith(1, "SELECT pg_advisory_lock($1)", [
      PG_MIGRATION_LOCK_KEY,
    ]);
    expect(conn.query).toHaveBeenNthCalledWith(
      2,
      "SELECT pg_advisory_unlock($1)",
      [PG_MIGRATION_LOCK_KEY],
    );
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it("acquires and releases a MySQL GET_LOCK on a dedicated pool connection", async () => {
    const events: string[] = [];
    const conn = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        events.push(`${text}:${JSON.stringify(values)}`);
        return [[{ locked: 1 }]];
      }),
      release: vi.fn(() => {
        events.push("release");
      }),
    };
    migratorMocks.mysqlMigrate.mockImplementationOnce(async () => {
      events.push("migrate");
    });

    const db = {
      $client: {
        promise: () => ({ getConnection: vi.fn(async () => conn) }),
      },
    };
    await runRemoteMigrations("mysql", db as never, {});

    expect(events).toEqual([
      `SELECT GET_LOCK(?, ?) AS locked:["${MYSQL_MIGRATION_LOCK_NAME}",${MYSQL_MIGRATION_LOCK_TIMEOUT_SEC}]`,
      "migrate",
      `SELECT RELEASE_LOCK(?):["${MYSQL_MIGRATION_LOCK_NAME}"]`,
      "release",
    ]);
  });

  it("fails without running migrate or RELEASE_LOCK if MySQL GET_LOCK times out", async () => {
    const conn = {
      query: vi.fn(async () => [[{ locked: 0 }]]),
      release: vi.fn(),
    };
    const db = {
      $client: {
        promise: () => ({ getConnection: vi.fn(async () => conn) }),
      },
    };

    await expect(
      runRemoteMigrations("mysql", db as never, {}),
    ).rejects.toThrow(/Failed to acquire MySQL migration lock/);
    expect(migratorMocks.mysqlMigrate).not.toHaveBeenCalled();
    expect(conn.query).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it("falls back to db.execute when $client pool is absent in test mocks", async () => {
    const execute = vi.fn(async () => [[{ locked: 1 }]]);
    const db = { execute };

    await runRemoteMigrations("postgres", db as never, {});
    expect(execute).toHaveBeenCalledTimes(2);
    expect(migratorMocks.pgMigrate).toHaveBeenCalledOnce();

    execute.mockClear();
    await runRemoteMigrations("mysql", db as never, {});
    expect(execute).toHaveBeenCalledTimes(2);
    expect(migratorMocks.mysqlMigrate).toHaveBeenCalledOnce();
  });
});
