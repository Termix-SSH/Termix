import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerLoginAlert } from "../../utils/alert-trigger.js";
import { SystemCrypto } from "../../utils/system-crypto.js";
import { sshLogger } from "../../utils/logger.js";

describe("triggerLoginAlert", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a rejected metrics-service request", async () => {
    vi.spyOn(SystemCrypto, "getInstance").mockReturnValue({
      getInternalAuthToken: vi.fn().mockResolvedValue("internal-token"),
    } as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"error":"Missing authentication token"}', {
        status: 401,
      }),
    );
    const warn = vi.spyOn(sshLogger, "warn").mockImplementation(() => {});

    await triggerLoginAlert(7, "user-1", "root", "192.0.2.1");

    expect(warn).toHaveBeenCalledWith(
      "Failed to trigger login alert",
      expect.objectContaining({
        operation: "login_alert_trigger_error",
        hostId: 7,
        error:
          'Metrics service returned 401: {"error":"Missing authentication token"}',
      }),
    );
  });

  it("does not log a warning when the metrics service accepts the event", async () => {
    vi.spyOn(SystemCrypto, "getInstance").mockReturnValue({
      getInternalAuthToken: vi.fn().mockResolvedValue("internal-token"),
    } as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"ok":true}', { status: 200 }),
    );
    const warn = vi.spyOn(sshLogger, "warn").mockImplementation(() => {});

    await triggerLoginAlert(7, "user-1", "root", "192.0.2.1");

    expect(warn).not.toHaveBeenCalled();
  });

  it("sends the internal auth token and login details the metrics service expects", async () => {
    vi.spyOn(SystemCrypto, "getInstance").mockReturnValue({
      getInternalAuthToken: vi.fn().mockResolvedValue("internal-token"),
    } as never);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    await triggerLoginAlert(42, "user-1", "root", "10.0.0.5");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:30005/internal/login-alert",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-internal-auth": "internal-token",
        }),
        body: JSON.stringify({
          hostId: 42,
          userId: "user-1",
          sshUser: "root",
          fromIp: "10.0.0.5",
        }),
      }),
    );
  });

  it("logs a warning if the fetch itself throws, instead of propagating", async () => {
    vi.spyOn(SystemCrypto, "getInstance").mockReturnValue({
      getInternalAuthToken: vi.fn().mockResolvedValue("internal-token"),
    } as never);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("connect ECONNREFUSED"),
    );
    const warn = vi.spyOn(sshLogger, "warn").mockImplementation(() => {});

    await expect(
      triggerLoginAlert(1, "user-1", "root", "127.0.0.1"),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      "Failed to trigger login alert",
      expect.objectContaining({ hostId: 1 }),
    );
  });
});
