import path from "path";
import { describe, expect, it } from "vitest";
import {
  migrationsFolder,
  runRemoteMigrations,
  MIGRATIONS_DIR_ENV,
} from "../../../database/db/migrate.js";

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
});
