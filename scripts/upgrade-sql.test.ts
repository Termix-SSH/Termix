import path from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY_TABLE_OWNERS } from "../packages/plugin-sdk/src/db";
import { buildUpgradeSql } from "./lib/upgrade-sql.mjs";

const SNAPSHOTS = path.resolve(
  __dirname,
  "../src/backend/tests/fixtures/upgrade",
);

const RENAME = {
  postgres: /^ALTER TABLE "([a-z0-9_]+)" RENAME TO "(p_[a-z0-9_]+)";$/gm,
  mysql: /^RENAME TABLE `([a-z0-9_]+)` TO `(p_[a-z0-9_]+)`;$/gm,
};

describe.each(["postgres", "mysql"] as const)(
  "the 2.8 to 2.9.0 upgrade SQL on %s",
  (dialect) => {
    const sql = buildUpgradeSql(dialect);
    const statements = sql.replace(/^--.*$/gm, "");

    it("matches the reviewed snapshot", async () => {
      await expect(sql).toMatchFileSnapshot(
        path.join(SNAPSHOTS, `upgrade-${dialect}.sql`),
      );
    });

    it("adopts every legacy table by renaming it, never by dropping it", () => {
      const renamed = new Set(
        [...sql.matchAll(RENAME[dialect])].map((match) => match[1]),
      );
      for (const table of Object.keys(LEGACY_TABLE_OWNERS)) {
        expect(renamed, table).toContain(table);
        expect(statements).not.toMatch(
          new RegExp(`DROP TABLE[^;]*[\`"]${table}[\`"]`, "i"),
        );
      }
    });

    it("never drops a column", () => {
      expect(statements).not.toMatch(/DROP COLUMN/i);
    });
  },
);
