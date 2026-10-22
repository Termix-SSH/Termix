import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  row: { sharedSource: '{"owner":"x"}' } as { sharedSource: string | null },
  updates: [] as unknown[],
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentRepositoryContext: () => ({
    drizzle: {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [h.row] }) }),
      }),
      update: () => ({
        set: (values: unknown) => ({
          where: async () => {
            h.updates.push(values);
          },
        }),
      }),
    },
  }),
}));

const { rejectSharedCopyWrites } =
  await import("../../sync/shared-copy-guard.js");

function run(body: Record<string, unknown>) {
  const guard = rejectSharedCopyWrites("host", /^\/db\/host\/(\d+)$/);
  const res = {
    code: 0,
    payload: undefined as unknown,
    status(code: number) {
      this.code = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
  const next = vi.fn();
  return guard(
    { method: "PUT", path: "/db/host/5", body } as never,
    res as never,
    next,
  ).then(() => ({ res, next }));
}

beforeEach(() => {
  process.env.ELECTRON_EMBEDDED = "true";
  h.row = { sharedSource: '{"owner":"x"}' };
  h.updates = [];
});

describe("shared copy guard", () => {
  it("refuses edits to a shared copy", async () => {
    const { res, next } = await run({ name: "new" });
    expect(res.code).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("still lets the connection origin change on this device", async () => {
    const { res, next } = await run({ name: "new", connectionOrigin: "local" });
    expect(res.code).toBe(0);
    expect(res.payload).toMatchObject({ connectionOrigin: "local" });
    expect(next).not.toHaveBeenCalled();
    expect(h.updates).toEqual([{ connectionOrigin: "local" }]);
  });

  it("passes hosts that are not shared copies", async () => {
    h.row = { sharedSource: null };
    const { next } = await run({ name: "new" });
    expect(next).toHaveBeenCalled();
  });
});
