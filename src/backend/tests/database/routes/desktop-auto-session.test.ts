import { describe, expect, it } from "vitest";
import type { Request } from "express";
import type { UserRecord } from "../../../database/repositories/user-repository.js";
import {
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
    ...overrides,
  } as UserRecord;
}

describe("isLoopbackRequest", () => {
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])(
    "accepts %s as loopback",
    (ip) => {
      expect(isLoopbackRequest({ ip, socket: {} } as unknown as Request)).toBe(
        true,
      );
    },
  );

  it("accepts an IPv4-mapped loopback suffix", () => {
    expect(
      isLoopbackRequest({
        ip: "::ffff:127.0.0.1",
        socket: {},
      } as unknown as Request),
    ).toBe(true);
  });

  it("rejects a non-loopback IP", () => {
    expect(
      isLoopbackRequest({
        ip: "192.168.1.50",
        socket: {},
      } as unknown as Request),
    ).toBe(false);
  });

  it("falls back to socket.remoteAddress when req.ip is empty", () => {
    expect(
      isLoopbackRequest({
        ip: "",
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as Request),
    ).toBe(true);
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

  it("declines when more than one user exists", () => {
    expect(
      resolveDesktopAutoSessionUser([
        makeUser({ id: "user-1" }),
        makeUser({ id: "user-2" }),
      ]),
    ).toBeNull();
  });
});
