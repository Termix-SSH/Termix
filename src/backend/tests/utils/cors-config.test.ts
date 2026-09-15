import { afterEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import { isCorsOriginAllowed } from "../../utils/cors-config.js";

function request(headers: Record<string, string> = {}): Request {
  return {
    headers,
    protocol: "http",
  } as unknown as Request;
}

afterEach(() => {
  delete process.env.CORS_ALLOWED_ORIGINS;
});

describe("isCorsOriginAllowed", () => {
  it("allows requests without an Origin header", () => {
    expect(isCorsOriginAllowed(request(), undefined)).toBe(true);
  });

  it("allows the externally forwarded same origin", () => {
    const req = request({
      "x-forwarded-proto": "https",
      "x-forwarded-host": "termix.example",
    });
    expect(isCorsOriginAllowed(req, "https://termix.example")).toBe(true);
  });

  it("rejects an unrelated origin even when the TCP peer is loopback", () => {
    const req = {
      ...request({ host: "termix.example" }),
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;
    expect(isCorsOriginAllowed(req, "https://attacker.example")).toBe(false);
  });

  it("allows an explicitly configured origin", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://portal.example";
    expect(isCorsOriginAllowed(request(), "https://portal.example")).toBe(true);
  });

  it("does not allow a wildcard with credentialed requests", () => {
    process.env.CORS_ALLOWED_ORIGINS = "*";
    expect(isCorsOriginAllowed(request(), "https://attacker.example")).toBe(
      false,
    );
  });
});
