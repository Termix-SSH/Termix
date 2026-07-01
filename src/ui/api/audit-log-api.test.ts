import { describe, expect, it } from "vitest";
import { mapAuditLog } from "./audit-log-api";

describe("mapAuditLog", () => {
  it("normalizes sqlite snake_case rows for the audit log UI", () => {
    expect(
      mapAuditLog({
        id: 3,
        user_id: "u1",
        username: "admin",
        action: "host_create",
        resource_type: "host",
        resource_id: "42",
        resource_name: "prod",
        details: "created",
        ip_address: "127.0.0.1",
        user_agent: "browser",
        success: 1,
        error_message: null,
        timestamp: "2026-06-30 12:00:00",
      }),
    ).toEqual({
      id: 3,
      userId: "u1",
      username: "admin",
      action: "host_create",
      resourceType: "host",
      resourceId: "42",
      resourceName: "prod",
      details: "created",
      ipAddress: "127.0.0.1",
      userAgent: "browser",
      success: true,
      errorMessage: null,
      timestamp: "2026-06-30 12:00:00",
    });
  });

  it("uses render-safe defaults for malformed rows", () => {
    const log = mapAuditLog({ success: 0 });

    expect(log.id).toBe(0);
    expect(log.action).toBe("unknown");
    expect(log.resourceType).toBe("unknown");
    expect(log.success).toBe(false);
  });
});
