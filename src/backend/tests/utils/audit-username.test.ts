import { describe, expect, it, vi, beforeEach } from "vitest";

const findById = vi.hoisted(() => vi.fn());

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentAuditLogRepository: () => ({ create: vi.fn() }),
  createCurrentUserRepository: () => ({ findById }),
}));

const { getAuditUsername, getRequestMeta } =
  await import("../../utils/audit-logger.js");

beforeEach(() => findById.mockReset());

describe("getAuditUsername", () => {
  it("resolves the username to store alongside the entry", async () => {
    findById.mockResolvedValueOnce({ id: "u-1", username: "alice" });

    await expect(getAuditUsername("u-1")).resolves.toBe("alice");
  });

  it("falls back to the id for an account that no longer exists", async () => {
    findById.mockResolvedValueOnce(undefined);

    await expect(getAuditUsername("u-gone")).resolves.toBe("u-gone");
  });

  it("never throws, so it cannot break the operation being audited", async () => {
    findById.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(getAuditUsername("u-1")).resolves.toBe("u-1");
  });
});

describe("getRequestMeta", () => {
  it("prefers the first x-forwarded-for hop", () => {
    const meta = getRequestMeta({
      headers: {
        "x-forwarded-for": "203.0.113.9, 10.0.0.1",
        "user-agent": "Mozilla/5.0",
      },
      ip: "10.0.0.1",
    } as never);

    expect(meta).toEqual({
      ipAddress: "203.0.113.9",
      userAgent: "Mozilla/5.0",
    });
  });

  it("falls back to the socket address", () => {
    const meta = getRequestMeta({ headers: {}, ip: "192.0.2.5" } as never);

    expect(meta.ipAddress).toBe("192.0.2.5");
    expect(meta.userAgent).toBe("");
  });
});
