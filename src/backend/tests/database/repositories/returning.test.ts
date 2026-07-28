import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deleteReturning,
  updateReturning,
} from "../../../database/repositories/returning.js";
import type { DatabaseContext } from "../../../database/repositories/database-context.js";
import type { DatabaseDialect } from "../../../database/db/dialect.js";

/**
 * The MySQL path cannot be exercised against a real engine here, and its whole
 * correctness is an ordering property: an update must be read AFTER the write,
 * a delete BEFORE it. Get either backwards and the rows describe the wrong
 * state — silently, with no error anywhere.
 *
 * So the drizzle handle is stubbed and the order of calls is recorded.
 */
function recordingContext(dialect: DatabaseDialect) {
  const calls: string[] = [];
  const rows = [{ id: 1, name: "before" }];

  const chain = (label: string, result: unknown) => {
    calls.push(label);
    const thenable = {
      set: () => thenable,
      from: () => thenable,
      where: () => thenable,
      returning: () => Promise.resolve(result),
      then: (resolve: (v: unknown) => void) =>
        Promise.resolve(result).then(resolve),
    };
    return thenable;
  };

  const db = {
    update: () => chain("update", rows),
    delete: () => chain("delete", rows),
    select: () => chain("select", rows),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => {
      calls.push("begin");
      return fn(db).then((value) => {
        calls.push("commit");
        return value;
      });
    },
  };

  return {
    context: { dialect, drizzle: db } as unknown as DatabaseContext,
    calls,
  };
}

const where = sql`id = 1`;

describe("updateReturning", () => {
  it.each(["sqlite", "postgres"] as const)(
    "uses a single statement on %s, where RETURNING exists",
    async (dialect) => {
      const { context, calls } = recordingContext(dialect);
      await updateReturning(context, {} as never, {}, where);
      expect(calls).toEqual(["update"]);
    },
  );

  it("on mysql, writes first and reads the new state after", async () => {
    const { context, calls } = recordingContext("mysql");
    await updateReturning(context, {} as never, {}, where);

    // Reading first would return the values the update replaced.
    expect(calls).toEqual(["begin", "update", "select", "commit"]);
  });
});

describe("deleteReturning", () => {
  it("uses a single statement where RETURNING exists", async () => {
    const { context, calls } = recordingContext("postgres");
    await deleteReturning(context, {} as never, where);
    expect(calls).toEqual(["delete"]);
  });

  it("on mysql, reads first and deletes after", async () => {
    const { context, calls } = recordingContext("mysql");
    const rows = await deleteReturning(context, {} as never, where);

    // Reading after the delete would find nothing at all.
    expect(calls).toEqual(["begin", "select", "delete", "commit"]);
    expect(rows).toHaveLength(1);
  });

  it("keeps both statements in one transaction", async () => {
    const { context, calls } = recordingContext("mysql");
    await deleteReturning(context, {} as never, where);

    // Without this, a concurrent write between them makes the returned rows
    // describe a state that never existed — and with a pool the second
    // statement need not even reach the same connection.
    expect(calls[0]).toBe("begin");
    expect(calls[calls.length - 1]).toBe("commit");
  });
});
