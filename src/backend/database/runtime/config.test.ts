import { describe, expect, it } from "vitest";
import { isExternalDatabase, parseDatabaseRuntimeConfig } from "./config.js";

describe("parseDatabaseRuntimeConfig", () => {
  it("defaults to sqlite under DATA_DIR", () => {
    const config = parseDatabaseRuntimeConfig({ DATA_DIR: "/app/data" });

    expect(config).toEqual({
      dialect: "sqlite",
      url: "file:/app/data/termix.sqlite",
      sqlitePath: "/app/data/termix.sqlite",
    });
  });

  it("accepts explicit sqlite file URLs", () => {
    const config = parseDatabaseRuntimeConfig({
      DB_TYPE: "sqlite",
      DATABASE_URL: "file:/tmp/termix.sqlite",
    });

    expect(config.sqlitePath).toBe("/tmp/termix.sqlite");
  });

  it("normalizes postgres aliases", () => {
    const config = parseDatabaseRuntimeConfig({
      DB_TYPE: "postgresql",
      DATABASE_URL: "postgres://termix:pass@db:5432/termix",
    });

    expect(config.dialect).toBe("postgres");
    expect(isExternalDatabase(config.dialect)).toBe(true);
  });

  it("normalizes mariadb as mysql", () => {
    const config = parseDatabaseRuntimeConfig({
      DB_TYPE: "mariadb",
      DATABASE_URL: "mysql://termix:pass@db:3306/termix",
    });

    expect(config.dialect).toBe("mysql");
    expect(isExternalDatabase(config.dialect)).toBe(true);
  });

  it("requires DATABASE_URL for external databases", () => {
    expect(() => parseDatabaseRuntimeConfig({ DB_TYPE: "postgres" })).toThrow(
      "DATABASE_URL is required",
    );
  });

  it("rejects unsupported database types", () => {
    expect(() => parseDatabaseRuntimeConfig({ DB_TYPE: "oracle" })).toThrow(
      "Unsupported DB_TYPE",
    );
  });
});
