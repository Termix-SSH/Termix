import { describe, expect, it } from "vitest";
import type { Request } from "express";
import type { UserRecord } from "../../../database/repositories/user-repository.js";
import {
  isDesktopAutoSessionEnabled,
  isLoopbackRequest,
  extractBearerOrCookieToken,
  resolveDesktopAutoSessionUser,
} from "../../../database/routes/desktop-auto-session.js";

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    username: "local",
    passwordHash: "",
    isOidc: false,
    totpEnabled: false,
    isAdmin: false,
    registeredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as UserRecord;
}

describe("isLoopbackRequest", () => {
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])(
    "accepts %s as loopback",
    (ip) => {
      expect(
        isLoopbackRequest({
          ip,
          headers: {},
          socket: { remoteAddress: ip },
        } as unknown as Request),
      ).toBe(true);
    },
  );

  it("accepts an IPv4-mapped loopback suffix", () => {
    expect(
      isLoopbackRequest({
        ip: "::ffff:127.0.0.1",
        headers: {},
        socket: { remoteAddress: "::ffff:127.0.0.1" },
      } as unknown as Request),
    ).toBe(true);
  });

  it("rejects a non-loopback TCP peer address", () => {
    expect(
      isLoopbackRequest({
        ip: "192.168.1.50",
        headers: {},
        socket: { remoteAddress: "192.168.1.50" },
      } as unknown as Request),
    ).toBe(false);
  });

  it("ignores a spoofed X-Forwarded-For value", () => {
    expect(
      isLoopbackRequest({
        ip: "127.0.0.1",
        headers: { "x-forwarded-for": "127.0.0.1" },
        socket: { remoteAddress: "203.0.113.10" },
      } as unknown as Request),
    ).toBe(false);
  });

  it("rejects requests that traversed the reverse proxy (X-Real-IP set)", () => {
    expect(
      isLoopbackRequest({
        ip: "127.0.0.1",
        headers: { "x-real-ip": "203.0.113.10" },
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as Request),
    ).toBe(false);
  });
});

describe("extractBearerOrCookieToken", () => {
  it("prefers the jwt cookie over the Authorization header", () => {
    const req = {
      cookies: { jwt: "cookie-token" },
      headers: { authorization: "Bearer header-token" },
    } as unknown as Request;
    expect(extractBearerOrCookieToken(req)).toBe("cookie-token");
  });

  it("falls back to a Bearer Authorization header", () => {
    const req = {
      cookies: {},
      headers: { authorization: "Bearer header-token" },
    } as unknown as Request;
    expect(extractBearerOrCookieToken(req)).toBe("header-token");
  });

  it("returns undefined when neither is present", () => {
    const req = { cookies: {}, headers: {} } as unknown as Request;
    expect(extractBearerOrCookieToken(req)).toBeUndefined();
  });

  it("ignores a non-Bearer Authorization header", () => {
    const req = {
      cookies: {},
      headers: { authorization: "Basic abc123" },
    } as unknown as Request;
    expect(extractBearerOrCookieToken(req)).toBeUndefined();
  });
});

describe("resolveDesktopAutoSessionUser", () => {
  it("returns the sole local user regardless of having a real password", () => {
    const user = makeUser({ passwordHash: "$2a$10$realbcryptvaluehere" });
    expect(resolveDesktopAutoSessionUser([user])).toBe(user);
  });

  it("returns the sole local user even when OIDC-enabled", () => {
    const user = makeUser({ isOidc: true });
    expect(resolveDesktopAutoSessionUser([user])).toBe(user);
  });

  it("returns the sole local user even when TOTP-enabled", () => {
    const user = makeUser({ totpEnabled: true });
    expect(resolveDesktopAutoSessionUser([user])).toBe(user);
  });

  it("returns the auto-provisioned passwordless placeholder", () => {
    const user = makeUser({ passwordHash: "" });
    expect(resolveDesktopAutoSessionUser([user])).toBe(user);
  });

  it("declines when zero users exist", () => {
    expect(resolveDesktopAutoSessionUser([])).toBeNull();
  });

  it("never declines for a multi-user local database -- prefers the admin account", () => {
    const admin = makeUser({
      id: "user-2",
      isAdmin: true,
      registeredAt: "2026-02-01T00:00:00.000Z",
    });
    const result = resolveDesktopAutoSessionUser([
      makeUser({
        id: "user-1",
        isAdmin: false,
        registeredAt: "2026-01-01T00:00:00.000Z",
      }),
      admin,
    ]);
    expect(result).toBe(admin);
  });

  it("falls back to the earliest-registered account when no admin exists", () => {
    const earliest = makeUser({
      id: "user-1",
      registeredAt: "2026-01-01T00:00:00.000Z",
    });
    const result = resolveDesktopAutoSessionUser([
      makeUser({ id: "user-2", registeredAt: "2026-03-01T00:00:00.000Z" }),
      earliest,
      makeUser({ id: "user-3", registeredAt: "2026-02-01T00:00:00.000Z" }),
    ]);
    expect(result).toBe(earliest);
  });
});

describe("isDesktopAutoSessionEnabled", () => {
  it("is off unless the Electron main process spawned this backend", () => {
    // A server deployment must never expose a credential-free login, whatever
    // the loopback heuristic says about the request.
    expect(isDesktopAutoSessionEnabled({})).toBe(false);
    expect(isDesktopAutoSessionEnabled({ ELECTRON_EMBEDDED: "false" })).toBe(
      false,
    );
    expect(isDesktopAutoSessionEnabled({ ELECTRON_EMBEDDED: "1" })).toBe(false);
  });

  it("is on for the embedded desktop backend", () => {
    expect(isDesktopAutoSessionEnabled({ ELECTRON_EMBEDDED: "true" })).toBe(
      true,
    );
  });
});
