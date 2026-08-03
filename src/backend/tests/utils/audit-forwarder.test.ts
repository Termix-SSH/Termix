import { describe, expect, it, vi, beforeEach } from "vitest";

const safeFetch = vi.hoisted(() => vi.fn());
const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));

vi.mock("../../utils/safe-outbound-fetch.js", () => ({
  safeOutboundFetch: safeFetch,
}));
vi.mock("../../utils/logger.js", () => ({ databaseLogger: logs }));

const {
  auditForwardTarget,
  forwardAuditEntry,
  forwardPayload,
  resetAuditForwarderState,
  AUDIT_FORWARD_URL_ENV,
  AUDIT_FORWARD_TOKEN_ENV,
} = await import("../../utils/audit-forwarder.js");

const ENTRY = {
  userId: "u-1",
  username: "alice",
  action: "delete_host",
  resourceType: "host",
  resourceId: "9",
  success: true,
  ipAddress: "203.0.113.9",
};

const NOW = new Date("2026-07-28T10:00:00.000Z");

beforeEach(() => {
  safeFetch.mockReset();
  logs.info.mockReset();
  logs.warn.mockReset();
  resetAuditForwarderState();
});

describe("auditForwardTarget", () => {
  it("is off unless a URL is configured", () => {
    expect(auditForwardTarget({})).toBeNull();
    expect(auditForwardTarget({ [AUDIT_FORWARD_URL_ENV]: "   " })).toBeNull();
  });

  it("carries an optional bearer token", () => {
    expect(
      auditForwardTarget({ [AUDIT_FORWARD_URL_ENV]: "https://siem/ingest" }),
    ).toEqual({ url: "https://siem/ingest" });

    expect(
      auditForwardTarget({
        [AUDIT_FORWARD_URL_ENV]: "https://siem/ingest",
        [AUDIT_FORWARD_TOKEN_ENV]: "secret",
      }),
    ).toEqual({ url: "https://siem/ingest", token: "secret" });
  });
});

describe("forwardPayload", () => {
  it("matches the export shape, with absent fields as null", () => {
    expect(forwardPayload(ENTRY, NOW)).toEqual({
      timestamp: "2026-07-28T10:00:00.000Z",
      userId: "u-1",
      username: "alice",
      action: "delete_host",
      resourceType: "host",
      resourceId: "9",
      resourceName: null,
      success: true,
      ipAddress: "203.0.113.9",
      userAgent: null,
      errorMessage: null,
      details: null,
    });
  });
});

describe("forwardAuditEntry", () => {
  const env = { [AUDIT_FORWARD_URL_ENV]: "https://siem.example/ingest" };

  it("does nothing when forwarding is not configured", async () => {
    await expect(forwardAuditEntry(ENTRY, NOW, {})).resolves.toBe(false);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("posts one NDJSON line through the SSRF-checked fetch", async () => {
    safeFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await expect(forwardAuditEntry(ENTRY, NOW, env)).resolves.toBe(true);

    const [url, init] = safeFetch.mock.calls[0];
    expect(url).toBe("https://siem.example/ingest");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-ndjson");
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body.trim()).action).toBe("delete_host");
    expect(init.body.endsWith("\n")).toBe(true);
  });

  it("sends the bearer token when one is set", async () => {
    safeFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await forwardAuditEntry(ENTRY, NOW, {
      ...env,
      [AUDIT_FORWARD_TOKEN_ENV]: "secret",
    });

    expect(safeFetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer secret",
    );
  });

  it("reports a rejected delivery without throwing", async () => {
    safeFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(forwardAuditEntry(ENTRY, NOW, env)).resolves.toBe(false);
    expect(logs.warn).toHaveBeenCalledWith(
      "Failed to forward audit entry",
      expect.objectContaining({ reason: "collector returned 503" }),
    );
  });

  it("swallows transport errors — a dead SIEM must not break auditing", async () => {
    safeFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(forwardAuditEntry(ENTRY, NOW, env)).resolves.toBe(false);
    expect(logs.warn).toHaveBeenCalledWith(
      "Failed to forward audit entry",
      expect.objectContaining({ reason: "ECONNREFUSED" }),
    );
  });

  it("stops repeating itself once the collector is persistently down", async () => {
    safeFetch.mockResolvedValue({ ok: false, status: 500 });

    for (let i = 0; i < 8; i++) {
      await forwardAuditEntry(ENTRY, NOW, env);
    }

    // 5 per-entry warnings, then one suppression notice — not 8.
    const perEntry = logs.warn.mock.calls.filter(
      (call) => call[0] === "Failed to forward audit entry",
    );
    expect(perEntry).toHaveLength(5);
    expect(
      logs.warn.mock.calls.some((call) =>
        String(call[0]).includes("suppressing further messages"),
      ),
    ).toBe(true);
    // It keeps trying regardless.
    expect(safeFetch).toHaveBeenCalledTimes(8);
  });

  it("announces recovery after a suppressed outage", async () => {
    safeFetch.mockResolvedValue({ ok: false, status: 500 });
    for (let i = 0; i < 6; i++) await forwardAuditEntry(ENTRY, NOW, env);

    safeFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    await forwardAuditEntry(ENTRY, NOW, env);

    expect(logs.info).toHaveBeenCalledWith(
      "Audit forwarding recovered",
      expect.objectContaining({ operation: "audit_forward_recovered" }),
    );
  });
});
