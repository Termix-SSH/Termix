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

  it("allows any origin when no allowlist is configured (self-hosted default)", () => {
    const req = request({ host: "termix.example" });
    expect(isCorsOriginAllowed(req, "https://anything.example")).toBe(true);
  });

  it("allows an explicitly configured origin", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://portal.example";
    expect(isCorsOriginAllowed(request(), "https://portal.example")).toBe(true);
  });

  it("rejects an unlisted origin once an allowlist is configured", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://portal.example";
    const req = request({ host: "termix.example" });
    expect(isCorsOriginAllowed(req, "https://attacker.example")).toBe(false);
  });
});
