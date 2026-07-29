import { describe, expect, it } from "vitest";
import {
  assertUrlMatchesDialect,
  connectRemoteDatabase,
  databaseUrl,
  DATABASE_URL_ENV,
} from "../../../database/db/connect.js";

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

describe("connectRemoteDatabase", () => {
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
});
