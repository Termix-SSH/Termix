import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  syncLogger: { warn: vi.fn() },
}));

const { clearSyncProviders, hasSyncProvider, provideSync, syncForwarder } =
  await import("../../sync/provider.js");

function response() {
  const res = {
    headersSent: false,
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

beforeEach(() => clearSyncProviders());

describe("sync forwarder", () => {
  it("passes through when nothing provides sync", () => {
    const next = vi.fn();
    syncForwarder({} as never, response() as never, next);
    expect(hasSyncProvider()).toBe(false);
    expect(next).toHaveBeenCalledWith();
  });

  it("hands the request to the provider", () => {
    const handle = vi.fn();
    provideSync("a", { handle });
    const next = vi.fn();
    syncForwarder({} as never, response() as never, next);
    expect(handle).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it("moves on when the provider calls next", () => {
    provideSync("a", { handle: (_req, _res, pass) => pass() });
    const second = vi.fn();
    provideSync("b", { handle: second });
    syncForwarder({} as never, response() as never, vi.fn());
    expect(second).toHaveBeenCalledOnce();
  });

  it("answers 500 when the provider throws", async () => {
    provideSync("a", {
      handle: async () => {
        throw new Error("boom");
      },
    });
    const res = response();
    syncForwarder({} as never, res as never, vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("stops forwarding after the provider is removed", () => {
    const remove = provideSync("a", { handle: vi.fn() });
    remove();
    const next = vi.fn();
    syncForwarder({} as never, response() as never, next);
    expect(next).toHaveBeenCalledWith();
  });
});
