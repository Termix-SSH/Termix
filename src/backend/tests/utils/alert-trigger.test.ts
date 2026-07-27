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
});
