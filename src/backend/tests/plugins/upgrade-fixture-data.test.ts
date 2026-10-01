/**
 * The committed 2.8 fixture still matches rows.ts and still fills every
 * table a plugin adopts. A new legacy table in LEGACY_TABLE_OWNERS fails here
 * until it gets fixture rows (npx tsx scripts/build-upgrade-fixture.ts).
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { LEGACY_TABLE_OWNERS } from "@termix/plugin-sdk/db";
import { FieldCrypto } from "../../utils/field-crypto.js";
import { UPGRADE_FIXTURE_DIR } from "./built-harness.js";
import {
  ENCRYPTED_COLUMNS,
  RECORDING_FILES,
  ROWS,
} from "../fixtures/upgrade/rows.js";

const sqlite = new Database(path.join(UPGRADE_FIXTURE_DIR, "db.sqlite"), {
  readonly: true,
});

afterAll(() => sqlite.close());

const count = (table: string) =>
  (
    sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as {
      n: number;
    }
  ).n;

describe("the committed 2.8 upgrade fixture", () => {
  it("fills every table a plugin adopts", () => {
    for (const table of Object.keys(LEGACY_TABLE_OWNERS)) {
      expect(ROWS[table]?.length ?? 0, table).toBeGreaterThan(0);
      expect(count(table), table).toBeGreaterThan(0);
    }
  });

  it("holds exactly the rows in rows.ts", () => {
    for (const [table, rows] of Object.entries(ROWS)) {
      // Each user also has a wrapped data key in settings.
      const extra = table === "settings" ? ROWS.users.length : 0;
      expect(count(table), table).toBe(rows.length + extra);
    }
  });

  it("stores the columns 2.8 encrypted as ciphertext", () => {
    for (const [table, column] of ENCRYPTED_COLUMNS) {
      const values = (
        sqlite
          .prepare(
            `SELECT "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL AND "${column}" <> ''`,
          )
          .all() as Array<{ value: string }>
      ).map((row) => row.value);
      for (const value of values) {
        expect(FieldCrypto.isEncrypted(value), `${table}.${column}`).toBe(true);
      }
    }
  });

  it("ships the recording files its rows point at", () => {
    for (const relative of Object.values(RECORDING_FILES)) {
      expect(
        fs.existsSync(path.join(UPGRADE_FIXTURE_DIR, "files", relative)),
        relative,
      ).toBe(true);
    }
  });
});
