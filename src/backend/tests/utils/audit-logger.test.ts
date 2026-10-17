import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentAuditLogRepository: vi.fn(() => ({
    create: createMock,
  })),
}));

import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";

describe("logAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMock.mockResolvedValue(undefined);
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

    expect(createMock).toHaveBeenCalledOnce();
    expect(createMock).toHaveBeenCalledWith(
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
    createMock.mockRejectedValue(new Error("db error"));

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
});

describe("logAudit plugin routine coalescing", () => {
  const WINDOW_MS = 10 * 60 * 1000;
  let run = 0;
  let details = "";

  const routine = (overrides: Record<string, unknown> = {}) =>
    logAudit({
      userId: null,
      username: "plugin:automations",
      action: "plugin_as_user",
      resourceType: "plugin",
      resourceId: "automations",
      details,
      success: true,
      ...overrides,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    createMock.mockResolvedValue(undefined);
    vi.useFakeTimers();
    // The coalescing memory is module state: a fresh key per test keeps them
    // independent.
    details = `automations ran background work as user-${++run}`;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes one row for identical successful plugin_as_user repeats in the window", async () => {
    await routine();
    vi.advanceTimersByTime(WINDOW_MS - 1);
    await routine();
    await routine();

    expect(createMock).toHaveBeenCalledOnce();
  });

  it("writes one row for identical successful plugin service calls in the window", async () => {
    const service = {
      action: "plugin_service_host_metrics_open",
      resourceId: "host-metrics",
    };
    await routine(service);
    await routine(service);

    expect(createMock).toHaveBeenCalledOnce();
  });

  it("writes again once the window has passed", async () => {
    await routine();
    vi.advanceTimersByTime(WINDOW_MS);
    await routine();

    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("always writes failures", async () => {
    await routine();
    await routine({ success: false, errorMessage: "boom" });
    await routine({ success: false, errorMessage: "boom" });

    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it("never coalesces non-plugin or non-routine actions", async () => {
    const login = {
      userId: "user-1",
      username: "alice",
      action: "login",
      resourceType: "user",
    };
    await routine(login);
    await routine(login);
    const secretRead = { action: "plugin_secret_shared_read" };
    await routine(secretRead);
    await routine(secretRead);
    const notPlugin = { username: "alice" };
    await routine(notPlugin);
    await routine(notPlugin);

    expect(createMock).toHaveBeenCalledTimes(6);
  });

  it("does not coalesce entries with different details or resourceId", async () => {
    await routine();
    await routine({ details: `${details} (other)` });
    await routine({ resourceId: "other-plugin" });
    await routine({ userId: "user-2" });

    expect(createMock).toHaveBeenCalledTimes(4);
  });
});

describe("getRequestMeta", () => {
  it("uses the proxy-validated Express IP", () => {
    const req = {
      headers: {
        "x-forwarded-for": "10.0.0.1, 10.0.0.2",
        "user-agent": "TestAgent/1.0",
      },
      ip: "127.0.0.1",
      socket: {},
    };
    const meta = getRequestMeta(req as never);
    expect(meta.ipAddress).toBe("127.0.0.1");
    expect(meta.userAgent).toBe("TestAgent/1.0");
  });

  it("falls back to req.ip when no forwarded header", () => {
    const req = {
      headers: { "user-agent": "Bot/2" },
      ip: "192.168.1.1",
      socket: {},
    };
    const meta = getRequestMeta(req as never);
    expect(meta.ipAddress).toBe("192.168.1.1");
  });

  it("ignores an unvalidated forwarded header", () => {
    const req = {
      headers: {
        "x-forwarded-for": ["10.0.0.1, 10.0.0.2"],
        "user-agent": "TestAgent/1.0",
      },
      socket: { remoteAddress: "203.0.113.9" },
    };
    const meta = getRequestMeta(req as never);
    expect(meta.ipAddress).toBe("203.0.113.9");
  });

  it("falls back to the socket peer when there is no forwarded header or req.ip", () => {
    const req = {
      headers: {},
      socket: { remoteAddress: "203.0.113.9" },
    };
    const meta = getRequestMeta(req as never);
    expect(meta.ipAddress).toBe("203.0.113.9");
  });

  it("returns 'unknown' rather than an empty string when no IP info exists", () => {
    const req = {
      headers: {},
      socket: {},
    };
    const meta = getRequestMeta(req as never);
    expect(meta.ipAddress).toBe("unknown");
  });
});
