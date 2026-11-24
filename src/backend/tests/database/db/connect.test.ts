import type { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertUrlMatchesDialect,
  connectRemoteDatabase,
  databaseUrl,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  poolMax,
  sslOption,
  DATABASE_POOL_MAX_ENV,
  DATABASE_SSL_ENV,
  DATABASE_URL_ENV,
} from "../../../database/db/connect.js";

const mockState = vi.hoisted(() => ({
  pgPoolSpy: vi.fn(),
  mysqlCreatePoolSpy: vi.fn(),
  lastPgPool: null as
    | (EventEmitter & { query: ReturnType<typeof vi.fn> })
    | null,
}));

vi.mock("pg", async () => {
  const { EventEmitter: EE } = await import("node:events");
  class FakePool extends EE {
    query = vi.fn();
    constructor(config: Record<string, unknown>) {
      super();
      mockState.pgPoolSpy(config);
      mockState.lastPgPool = this;
    }
  }
  return { default: { Pool: FakePool }, Pool: FakePool };
});

vi.mock("mysql2", async () => {
  const { EventEmitter: EE } = await import("node:events");
  const createPool = (config: Record<string, unknown>) => {
    mockState.mysqlCreatePoolSpy(config);
    const pool = Object.assign(new EE(), {
      query: vi.fn(),
      execute: vi.fn(),
    });
    return pool;
  };
  return { default: { createPool }, createPool };
});

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn((opts: unknown) => ({ __pgDrizzle: opts })),
}));

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn((opts: unknown) => ({ __mysqlDrizzle: opts })),
}));

beforeEach(() => {
  mockState.pgPoolSpy.mockClear();
  mockState.mysqlCreatePoolSpy.mockClear();
  mockState.lastPgPool = null;
});

describe("databaseUrl", () => {
  it("is absent unless set", () => {
    expect(databaseUrl({})).toBeNull();
    expect(databaseUrl({ [DATABASE_URL_ENV]: "   " })).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(
      databaseUrl({ [DATABASE_URL_ENV]: "  postgres://db/termix  " }),
    ).toBe("postgres://db/termix");
  });
});

describe("assertUrlMatchesDialect", () => {
  it("accepts the schemes each engine answers to", () => {
    expect(() =>
      assertUrlMatchesDialect("postgres://db/termix", "postgres"),
    ).not.toThrow();
    expect(() =>
      assertUrlMatchesDialect("postgresql://db/termix", "postgres"),
    ).not.toThrow();
    expect(() =>
      assertUrlMatchesDialect("mysql://db/termix", "mysql"),
    ).not.toThrow();
    // MariaDB speaks the MySQL protocol.
    expect(() =>
      assertUrlMatchesDialect("mariadb://db/termix", "mysql"),
    ).not.toThrow();
  });

  it("is case-insensitive about the scheme", () => {
    expect(() =>
      assertUrlMatchesDialect("POSTGRES://db/termix", "postgres"),
    ).not.toThrow();
  });

  it("catches a mismatch and says what is wrong", () => {
    // The failure mode this exists to prevent: a driver error thirty frames
    // down that never mentions the actual misconfiguration.
    expect(() =>
      assertUrlMatchesDialect("mysql://db/termix", "postgres"),
    ).toThrow(/is a "mysql:\/\/" URL but DATABASE_DIALECT is "postgres"/);

    expect(() =>
      assertUrlMatchesDialect("postgres://db/termix", "mysql"),
    ).toThrow(/expected one of mysql:\/\/, mariadb:\/\//i);
  });

  it("rejects sqlite, which does not use a URL", () => {
    expect(() =>
      assertUrlMatchesDialect("postgres://db/termix", "sqlite"),
    ).toThrow(/does not use DATABASE_URL/);
  });
});

describe("poolMax", () => {
  it("defaults to the driver's own pool size", () => {
    expect(poolMax({})).toBe(10);
    expect(poolMax({ [DATABASE_POOL_MAX_ENV]: "  " })).toBe(10);
  });

  it("takes a positive integer", () => {
    expect(poolMax({ [DATABASE_POOL_MAX_ENV]: "25" })).toBe(25);
  });

  it("refuses a value that would silently produce a broken pool", () => {
    for (const bad of ["0", "-1", "3.5", "lots"]) {
      expect(() => poolMax({ [DATABASE_POOL_MAX_ENV]: bad })).toThrow(
        /positive integer/,
      );
    }
  });
});

describe("sslOption", () => {
  it("is off unless asked for, so existing installs are unaffected", () => {
    expect(sslOption({})).toBe(false);
    expect(sslOption({ [DATABASE_SSL_ENV]: "false" })).toBe(false);
    expect(sslOption({ [DATABASE_SSL_ENV]: "disable" })).toBe(false);
  });

  it("verifies the certificate for require", () => {
    expect(sslOption({ [DATABASE_SSL_ENV]: "require" })).toEqual({
      rejectUnauthorized: true,
    });
    expect(sslOption({ [DATABASE_SSL_ENV]: "TRUE" })).toEqual({
      rejectUnauthorized: true,
    });
  });

  it("allows a self-signed certificate only when told to skip verification", () => {
    expect(sslOption({ [DATABASE_SSL_ENV]: "no-verify" })).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("refuses a value it does not understand rather than quietly disabling TLS", () => {
    expect(() => sslOption({ [DATABASE_SSL_ENV]: "maybe" })).toThrow(
      /Unsupported DATABASE_SSL/,
    );
  });
});

describe("connectRemoteDatabase", () => {
  it("validates pool settings before opening a connection", () => {
    return expect(
      connectRemoteDatabase("postgres", {
        [DATABASE_URL_ENV]: "postgres://db/termix",
        [DATABASE_POOL_MAX_ENV]: "nonsense",
      }),
    ).rejects.toThrow(/positive integer/);
  });

  it("refuses to connect without a URL, naming the variable", () => {
    return expect(connectRemoteDatabase("postgres", {})).rejects.toThrow(
      /DATABASE_URL must be set when DATABASE_DIALECT is "postgres"/,
    );
  });

  it("rejects a mismatched URL before opening a connection", () => {
    return expect(
      connectRemoteDatabase("postgres", {
        [DATABASE_URL_ENV]: "mysql://db/termix",
      }),
    ).rejects.toThrow(/DATABASE_DIALECT is "postgres"/);
  });

  it("configures PostgreSQL pool timeouts and registers an error listener", async () => {
    await connectRemoteDatabase("postgres", {
      [DATABASE_URL_ENV]: "postgres://db/termix",
      [DATABASE_POOL_MAX_ENV]: "15",
    });

    expect(mockState.pgPoolSpy).toHaveBeenCalledWith({
      connectionString: "postgres://db/termix",
      max: 15,
      connectionTimeoutMillis: DEFAULT_CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: DEFAULT_IDLE_TIMEOUT_MS,
    });
    expect(mockState.lastPgPool).not.toBeNull();
    expect(mockState.lastPgPool!.listenerCount("error")).toBeGreaterThan(0);
    expect(() =>
      mockState.lastPgPool!.emit("error", new Error("idle connection reset")),
    ).not.toThrow();
  });

  it("configures MySQL pool connectTimeout", async () => {
    await connectRemoteDatabase("mysql", {
      [DATABASE_URL_ENV]: "mysql://db/termix",
      [DATABASE_POOL_MAX_ENV]: "12",
    });

    expect(mockState.mysqlCreatePoolSpy).toHaveBeenCalledWith({
      uri: "mysql://db/termix",
      connectionLimit: 12,
      connectTimeout: DEFAULT_CONNECTION_TIMEOUT_MS,
    });
  });
});
