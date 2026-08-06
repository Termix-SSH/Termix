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

describe("updateReturning, when the read-back cannot find the rows", () => {
  /**
   * The failure mode: an update that changes a column its own `where` filters
   * on. MySQL writes the rows, then the re-read matches nothing. Returning []
   * would be indistinguishable from "matched nothing" and silently wrong.
   */
  function contextThatWritesButCannotReadBack() {
    const chain = (result: unknown) => {
      const thenable: Record<string, unknown> = {
        set: () => thenable,
        from: () => thenable,
        where: () => thenable,
        then: (resolve: (v: unknown) => void) =>
          Promise.resolve(result).then(resolve),
      };
      return thenable;
    };
    const db = {
      update: () => chain({ affectedRows: 3 }),
      select: () => chain([]),
      transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    };
    return { dialect: "mysql", drizzle: db } as unknown as DatabaseContext;
  }

  it("throws instead of returning an empty array", async () => {
    await expect(
      updateReturning(
        contextThatWritesButCannotReadBack(),
        {} as never,
        {},
        where,
      ),
    ).rejects.toThrow(/wrote 3 row\(s\) but could not read them back/);
  });

  it("says how to fix it", async () => {
    await expect(
      updateReturning(
        contextThatWritesButCannotReadBack(),
        {} as never,
        {},
        where,
      ),
    ).rejects.toThrow(/filter on a column the update leaves alone/);
  });

  it("still returns [] when the update genuinely matched nothing", async () => {
    const { context } = recordingContext("mysql");
    // recordingContext reports rows for select, so use a zero-write stub.
    const chain = (result: unknown) => {
      const t: Record<string, unknown> = {
        set: () => t,
        from: () => t,
        where: () => t,
        then: (r: (v: unknown) => void) => Promise.resolve(result).then(r),
      };
      return t;
    };
    const db = {
      update: () => chain({ affectedRows: 0 }),
      select: () => chain([]),
      transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    };
    void context;
    await expect(
      updateReturning(
        { dialect: "mysql", drizzle: db } as unknown as DatabaseContext,
        {} as never,
        {},
        where,
      ),
    ).resolves.toEqual([]);
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
