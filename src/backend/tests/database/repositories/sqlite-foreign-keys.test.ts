import { afterEach, describe, expect, it, vi } from "vitest";

const factory = vi.hoisted(() => ({
  getCurrentRepositorySqlite: vi.fn(),
}));

vi.mock("../../../database/repositories/factory.js", () => factory);

import {
  withCurrentSqliteForeignKeysDisabled,
  withSqliteForeignKeysDisabled,
} from "../../../database/repositories/sqlite-foreign-keys.js";

const previousDatabaseDialect = process.env.DATABASE_DIALECT;

afterEach(() => {
  if (previousDatabaseDialect === undefined)
    delete process.env.DATABASE_DIALECT;
  else process.env.DATABASE_DIALECT = previousDatabaseDialect;
  vi.clearAllMocks();
});

describe("withSqliteForeignKeysDisabled", () => {
  it("restores foreign keys after an import", async () => {
    const sqlite = { exec: vi.fn() };

    await expect(
      withSqliteForeignKeysDisabled(sqlite, async () => "imported"),
    ).resolves.toBe("imported");
    expect(sqlite.exec.mock.calls).toEqual([
      ["PRAGMA foreign_keys = OFF"],
      ["PRAGMA foreign_keys = ON"],
    ]);
  });
});

describe("withCurrentSqliteForeignKeysDisabled", () => {
  it.each(["postgres", "mysql"])(
    "runs portable imports with constraints enabled on %s",
    async (dialect) => {
      process.env.DATABASE_DIALECT = dialect;
      const operation = vi.fn().mockResolvedValue("imported");

      await expect(
        withCurrentSqliteForeignKeysDisabled(operation),
      ).resolves.toBe("imported");
      expect(operation).toHaveBeenCalledOnce();
      expect(factory.getCurrentRepositorySqlite).not.toHaveBeenCalled();
    },
  );
});
