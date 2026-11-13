/**
 * Login methods and keyboard-interactive handlers in a plugin process: what
 * a method sees of the request, which cookies it may set, and what core
 * keeps of its answers.
 */
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { LoginMethodError } from "@termix-ssh/plugin-sdk/backend";
import {
  applyCookieDirectives,
  plainLoginRequest,
  readCookieDirectives,
  readIdentity,
  readLoginError,
  remoteKeyboardInteractiveHandler,
  remoteLoginMethod,
} from "../../../plugins/sandbox/login-bridge.js";

const PREFIX = "tmxp_sso_";

function deps() {
  return {
    cookiePrefix: PREFIX,
    headers: vi.fn(() => ({ referer: "https://termix.example/" })),
    baseUrl: vi.fn(() => "https://termix.example"),
    visibleHost: vi.fn(async (host: unknown) => ({
      ...(host as object),
      password: undefined,
    })),
  };
}

function liveRequest(over: Record<string, unknown> = {}) {
  const res = { cookie: vi.fn(), clearCookie: vi.fn(), headersSent: false };
  const req = {
    body: { username: "a" },
    query: { providerId: "1" },
    headers: { cookie: "jwt=secret", authorization: "Bearer x" },
    ip: "10.0.0.5",
    res,
    ...over,
  } as unknown as Request;
  return { req, res };
}

describe("plain login request", () => {
  it("carries body, query, filtered headers, address and base URL only", () => {
    const d = deps();
    const { req } = liveRequest();
    const plain = plainLoginRequest(req, d);
    expect(plain).toEqual({
      body: { username: "a" },
      query: { providerId: "1" },
      headers: { referer: "https://termix.example/" },
      ip: "10.0.0.5",
      termixBaseUrl: "https://termix.example",
    });
    expect(d.headers).toHaveBeenCalledWith(req);
    expect(plain).not.toHaveProperty("res");
  });
});

describe("cookie directives", () => {
  it("keeps only the plugin's own names and safe options", () => {
    const kept = readCookieDirectives(
      [
        {
          name: "tmxp_sso_binding",
          value: "v",
          options: {
            httpOnly: true,
            sameSite: "lax",
            path: "/plugin-api/sso/callback",
            maxAge: 1000,
            domain: "evil.example",
          },
        },
        { name: "jwt", value: "stolen" },
        { name: "tmxp_sso_x;y", value: "v" },
        { name: "tmxp_sso_big", value: "x".repeat(5000) },
        { name: "tmxp_sso_old", clear: true, options: { path: "/a b" } },
      ],
      PREFIX,
    );
    expect(kept).toEqual([
      {
        name: "tmxp_sso_binding",
        value: "v",
        clear: false,
        options: {
          httpOnly: true,
          sameSite: "lax",
          path: "/plugin-api/sso/callback",
          maxAge: 1000,
        },
      },
      { name: "tmxp_sso_old", value: "", clear: true, options: {} },
    ]);
    expect(readCookieDirectives("nope", PREFIX)).toEqual([]);
  });

  it("applies them to the live response unless it already answered", () => {
    const { req, res } = liveRequest();
    applyCookieDirectives(req, [
      { name: "tmxp_sso_a", value: "1", clear: false, options: {} },
      { name: "tmxp_sso_b", value: "", clear: true, options: {} },
    ]);
    expect(res.cookie).toHaveBeenCalledWith("tmxp_sso_a", "1", {});
    expect(res.clearCookie).toHaveBeenCalledWith("tmxp_sso_b", {});
    res.headersSent = true;
    applyCookieDirectives(req, [
      { name: "tmxp_sso_c", value: "1", clear: false, options: {} },
    ]);
    expect(res.cookie).toHaveBeenCalledTimes(1);
  });
});

describe("answers", () => {
  it("rebuilds a login error with its return address", () => {
    const error = readLoginError({
      message: "nope",
      status: 401,
      code: "denied",
      returnTo: "https://termix.example/",
      remainingTime: 30,
    });
    expect(error).toBeInstanceOf(LoginMethodError);
    expect(error).toMatchObject({
      message: "nope",
      status: 401,
      code: "denied",
      returnTo: "https://termix.example/",
      remainingTime: 30,
    });
    expect(readLoginError({ status: 200 }).status).toBe(400);
  });

  it("keeps only known identity fields of the right type", () => {
    expect(
      readIdentity({
        kind: "external",
        provider: "oidc:1",
        subject: "abc",
        email: 5,
        groups: ["a", 1],
        isAdmin: "yes",
        roles: { desired: ["admin"], managed: ["admin", 3] },
        logoutClaims: { providerId: 1, sub: "abc", sid: null },
        extra: "dropped",
      }),
    ).toEqual({
      kind: "external",
      provider: "oidc:1",
      subject: "abc",
      email: undefined,
      groups: ["a"],
      roles: { desired: ["admin"], managed: ["admin"] },
      logoutClaims: { providerId: 1, sub: "abc", sid: null },
    });
    expect(readIdentity({ kind: "user", userId: "u1", extra: 1 })).toEqual({
      kind: "user",
      userId: "u1",
    });
    expect(() => readIdentity({ kind: "admin" })).toThrow(/unknown/);
    expect(() => readIdentity({ kind: "user" })).toThrow(/no user/);
    expect(() => readIdentity(null)).toThrow(/no identity/);
  });
});

describe("remote login method", () => {
  it("runs start with a plain request and applies its cookies", async () => {
    const start = vi.fn(async (request: Record<string, unknown>) => {
      expect(request.headers).toEqual({ referer: "https://termix.example/" });
      return {
        value: { redirectUrl: "https://idp.example/auth" },
        cookies: [
          { name: "tmxp_sso_binding", value: "b" },
          { name: "jwt", value: "x" },
        ],
      };
    });
    const method = remoteLoginMethod(
      { id: "oidc", labelKey: "k", kind: "redirect", external: true, start },
      deps(),
    );
    const { req, res } = liveRequest();
    await expect(method.start!(req as never, "1")).resolves.toEqual({
      redirectUrl: "https://idp.example/auth",
    });
    expect(start.mock.calls[0][1]).toBe("1");
    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith("tmxp_sso_binding", "b", {});
    expect(method.external).toBe(true);
  });

  it("refuses a redirect that is not http(s)", async () => {
    const method = remoteLoginMethod(
      {
        id: "oidc",
        labelKey: "k",
        kind: "redirect",
        start: async () => ({ value: { redirectUrl: "javascript:alert(1)" } }),
      },
      deps(),
    );
    await expect(
      method.start!(liveRequest().req as never, null),
    ).rejects.toThrow(/http/);
  });

  it("throws the plugin's error after applying cookies it set first", async () => {
    const method = remoteLoginMethod(
      {
        id: "oidc",
        labelKey: "k",
        kind: "redirect",
        callback: async () => ({
          error: {
            message: "other browser",
            status: 400,
            returnTo: "https://t/",
          },
          cookies: [{ name: "tmxp_sso_binding", clear: true }],
        }),
      },
      deps(),
    );
    const { req, res } = liveRequest();
    await expect(method.callback!(req as never)).rejects.toMatchObject({
      message: "other browser",
      returnTo: "https://t/",
    });
    expect(res.clearCookie).toHaveBeenCalledWith("tmxp_sso_binding", {});
  });

  it("describes only plain instances", async () => {
    const method = remoteLoginMethod(
      {
        id: "ldap",
        labelKey: "k",
        kind: "form",
        describe: async () => [
          { id: 1, label: "Corp", enabled: true, secret: "x" },
          "junk",
        ],
      },
      deps(),
    );
    expect(await method.describe!()).toEqual([
      { id: "1", label: "Corp", enabled: true },
    ]);
  });

  it("refuses a method without id or a known kind", () => {
    expect(() =>
      remoteLoginMethod({ labelKey: "k", kind: "form" }, deps()),
    ).toThrow(/id and labelKey/);
    expect(() =>
      remoteLoginMethod({ id: "x", labelKey: "k", kind: "x" }, deps()),
    ).toThrow(/redirect or form/);
  });
});

describe("remote keyboard-interactive handler", () => {
  it("asks with no secrets and plain settings", async () => {
    const detect = vi.fn(async () => ({
      kind: "browser",
      url: "https://wg/login",
      code: "a b c d",
      instructions: "approve",
    }));
    const auto = vi.fn(async () => true);
    const handler = remoteKeyboardInteractiveHandler(
      { id: "warpgate", label: "Warpgate", detect, autoAnswerPasswords: auto },
      deps(),
    );
    const host = { id: 1, password: "hunter2" } as never;
    expect(
      await handler.detect(
        { name: "Warpgate authentication", instructions: "", prompts: [] },
        host,
        { useWarpgate: true, nested: { x: 1 } },
      ),
    ).toEqual({
      kind: "browser",
      url: "https://wg/login",
      code: "a b c d",
      instructions: "approve",
    });
    const [, seenHost, seenSettings] = detect.mock.calls[0] as unknown[];
    expect((seenHost as { password?: string }).password).toBeUndefined();
    expect(seenSettings).toEqual({ useWarpgate: true });
    expect(await handler.autoAnswerPasswords!(host, {})).toBe(true);
    expect(handler.remote).toBe(true);
  });
});
