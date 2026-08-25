import { afterEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import { isAllowedOrigin } from "../../utils/cors-config.js";

const originalAllowed = process.env.CORS_ALLOWED_ORIGINS;

afterEach(() => {
  if (originalAllowed === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = originalAllowed;
  }
});

/** A request as it reaches the backend through the bundled nginx. */
function proxiedRequest(headers: Record<string, string>) {
  return {
    headers,
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request;
}

const behindProxy = proxiedRequest({
  host: "termix.example.com",
  "x-forwarded-proto": "https",
  "x-forwarded-host": "termix.example.com",
});

describe("isAllowedOrigin", () => {
  it("allows the origin the request was actually made to", () => {
    expect(isAllowedOrigin("https://termix.example.com", behindProxy)).toBe(
      true,
    );
  });

  it("rejects a foreign origin even though the TCP peer is loopback", () => {
    // Every request arrives from 127.0.0.1 in a containerized deployment,
    // so a peer-address check would reflect this origin with credentials.
    expect(isAllowedOrigin("https://evil.example", behindProxy)).toBe(false);
  });

  it("rejects an origin that merely looks like the real host", () => {
    expect(
      isAllowedOrigin("https://termix.example.com.evil.example", behindProxy),
    ).toBe(false);
    expect(isAllowedOrigin("http://termix.example.com", behindProxy)).toBe(
      false,
    );
  });

  it("allows the desktop app and local dev clients", () => {
    expect(isAllowedOrigin("file://", behindProxy)).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173", behindProxy)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:30001", behindProxy)).toBe(true);
    expect(isAllowedOrigin("http://[::1]:8080", behindProxy)).toBe(true);
  });

  it("honours the configured allowlist", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://dash.example.com";
    expect(isAllowedOrigin("https://dash.example.com", behindProxy)).toBe(true);
    expect(isAllowedOrigin("https://other.example.com", behindProxy)).toBe(
      false,
    );
  });

  it("refuses a wildcard, which cannot be combined with credentials", () => {
    // This middleware sets credentials: true, and reflecting an arbitrary
    // origin alongside credentials hands every website the visitor's session.
    process.env.CORS_ALLOWED_ORIGINS = "*";
    expect(isAllowedOrigin("https://evil.example", behindProxy)).toBe(false);
  });

  it("honours the named origins in a list that also contains a wildcard", () => {
    process.env.CORS_ALLOWED_ORIGINS = "*,https://dash.example.com";
    expect(isAllowedOrigin("https://dash.example.com", behindProxy)).toBe(true);
    expect(isAllowedOrigin("https://evil.example", behindProxy)).toBe(false);
  });
});
