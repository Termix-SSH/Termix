import { describe, expect, it } from "vitest";
import {
  assertNotPre29Database,
  PRE_29_DATABASE_ERROR,
} from "../../../database/db/upgrade-guard.js";

const tables = (...names: string[]) => (name: string) => names.includes(name);

describe("assertNotPre29Database", () => {
  it("refuses a 2.8 database, which has hosts but no plugins table", async () => {
    await expect(assertNotPre29Database(tables("ssh_data"))).rejects.toThrow(
      PRE_29_DATABASE_ERROR,
    );
  });

  it("opens a database 2.9 has upgraded", async () => {
    await expect(
      assertNotPre29Database(tables("ssh_data", "plugins")),
    ).resolves.toBeUndefined();
  });

  it("opens a new database", async () => {
    await expect(assertNotPre29Database(tables())).resolves.toBeUndefined();
  });
});
