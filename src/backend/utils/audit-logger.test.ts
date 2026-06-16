import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../database/db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    $client: {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 0 }),
        run: vi.fn(),
      }),
    },
  },
}));

import { logAudit, getRequestMeta } from "./audit-logger.js";
import { db } from "../database/db/index.js";

const mockDb = db as {
  insert: ReturnType<typeof vi.fn>;
  $client: { prepare: ReturnType<typeof vi.fn> };
};

describe("logAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.$client.prepare.mockReturnValue({
      get: vi.fn().mockReturnValue({ count: 0 }),
      run: vi.fn(),
    });
  });

  it("inserts an audit log entry with all required fields", async () => {
    const params = {
      userId: "user-1",
      username: "alice",
      action: "create_host",
      resourceType: "host",
      resourceId: "42",
      resourceName: "my-server",
      ipAddress: "1.2.3.4",
      userAgent: "Mozilla/5.0",
      success: true,
    };

    await logAudit(params);

    expect(mockDb.insert).toHaveBeenCalledOnce();
    const valuesFn = mockDb.insert.mock.results[0].value.values;
    expect(valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        username: "alice",
        action: "create_host",
        resourceType: "host",
        resourceId: "42",
        resourceName: "my-server",
        success: true,
      }),
    );
  });

  it("does not throw when insert fails", async () => {
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error("db error")),
    });

    await expect(
      logAudit({
        userId: "u",
        username: "u",
        action: "x",
        resourceType: "y",
        success: false,
      }),
    ).resolves.toBeUndefined();
  });

  it("triggers pruning when row count exceeds threshold", async () => {
    const prepareMock = vi.fn();
    const runMock = vi.fn();
    prepareMock.mockImplementation((sql: string) => {
      if (sql.includes("COUNT(*)")) {
        return { get: () => ({ count: 10001 }) };
      }
      return { run: runMock };
    });
    mockDb.$client.prepare = prepareMock;

    await logAudit({
      userId: "u",
      username: "u",
      action: "x",
      resourceType: "y",
      success: true,
    });

    const deleteCalled = prepareMock.mock.calls.some((args: unknown[]) =>
      String(args[0]).includes("DELETE"),
    );
    expect(deleteCalled).toBe(true);
    expect(runMock).toHaveBeenCalledWith(1001);
  });
});

describe("getRequestMeta", () => {
  it("extracts ip from x-forwarded-for header", () => {
    const req = {
      headers: {
        "x-forwarded-for": "10.0.0.1, 10.0.0.2",
        "user-agent": "TestAgent/1.0",
      },
      ip: "127.0.0.1",
    };
    const meta = getRequestMeta(req as never);
    expect(meta.ipAddress).toBe("10.0.0.1");
    expect(meta.userAgent).toBe("TestAgent/1.0");
  });

  it("falls back to req.ip when no forwarded header", () => {
    const req = {
      headers: { "user-agent": "Bot/2" },
      ip: "192.168.1.1",
    };
    const meta = getRequestMeta(req as never);
    expect(meta.ipAddress).toBe("192.168.1.1");
  });
});
