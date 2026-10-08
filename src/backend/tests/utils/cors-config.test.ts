import { afterEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import {
  isCorsOriginAllowed,
  isDesktopAppOrigin,
} from "../../utils/cors-config.js";

function request(headers: Record<string, string> = {}): Request {
  return {
    headers,
    protocol: "http",
  } as unknown as Request;
}

afterEach(() => {
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.ELECTRON_EMBEDDED;
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

  describe("embedded desktop backend", () => {
    it("rejects other websites even with no allowlist", () => {
      process.env.ELECTRON_EMBEDDED = "true";
      const req = request({ host: "127.0.0.1:30001" });
      expect(isCorsOriginAllowed(req, "https://evil.example")).toBe(false);
    });

    it("still allows the desktop app and the dev server", () => {
      process.env.ELECTRON_EMBEDDED = "true";
      const req = request({ host: "127.0.0.1:30001" });
      expect(isCorsOriginAllowed(req, "file://")).toBe(true);
      expect(isCorsOriginAllowed(req, "http://localhost:5173")).toBe(true);
      expect(isCorsOriginAllowed(req, undefined)).toBe(true);
    });

    it("allows an explicitly configured origin", () => {
      process.env.ELECTRON_EMBEDDED = "true";
      process.env.CORS_ALLOWED_ORIGINS = "https://portal.example";
      expect(isCorsOriginAllowed(request(), "https://portal.example")).toBe(
        true,
      );
    });
  });
});

describe("isDesktopAppOrigin", () => {
  it("accepts no origin, file:// and the dev server", () => {
    expect(isDesktopAppOrigin(undefined)).toBe(true);
    expect(isDesktopAppOrigin("file://")).toBe(true);
    expect(isDesktopAppOrigin("http://127.0.0.1:5173")).toBe(true);
  });

  it("rejects websites", () => {
    expect(isDesktopAppOrigin("https://evil.example")).toBe(false);
    expect(isDesktopAppOrigin("null")).toBe(false);
  });
});
