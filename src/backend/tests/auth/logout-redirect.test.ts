import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

const findById = vi.fn();

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSessionRepository: () => ({ findById }),
}));

vi.mock("../../utils/request-origin.js", () => ({
  getRequestBaseUrlWithForceHTTPS: () => "https://termix.example",
}));

const { logoutRedirectFor, safeRedirect } =
  await import("../../auth/logout-redirect.js");
const { registerLoginMethod } = await import("../../auth/registry.js");

const req = {} as Request;
const disposers: Array<() => void> = [];

afterEach(() => {
  findById.mockReset();
  while (disposers.length) disposers.pop()!();
});

function method(logoutRedirect: (s: unknown) => Promise<string | null>) {
  disposers.push(
    registerLoginMethod({
      id: "sso-test",
      labelKey: "k",
      kind: "redirect",
      pluginId: "sso",
      logoutRedirect,
    }),
  );
}

function session(ref: Record<string, unknown> | null) {
  findById.mockResolvedValue({
    id: "s1",
    externalSessionRef: ref ? JSON.stringify(ref) : null,
  });
}

describe("logout redirect", () => {
  it("asks the method that made the session", async () => {
    const ask = vi.fn(async () => "https://idp.example/logout?client_id=a");
    method(ask);
    session({ providerId: 2, sub: "u", sid: "x", methodId: "sso-test" });
    expect(await logoutRedirectFor("s1", req)).toBe(
      "https://idp.example/logout?client_id=a",
    );
    expect(ask).toHaveBeenCalledWith({
      providerId: 2,
      sub: "u",
      sid: "x",
      baseUrl: "https://termix.example",
    });
  });

  it("gives nothing for other sessions, odd answers and failures", async () => {
    method(async () => "javascript:alert(1)");
    session({ sub: "u", methodId: "sso-test" });
    expect(await logoutRedirectFor("s1", req)).toBeNull();

    session({ sub: "u" });
    expect(await logoutRedirectFor("s1", req)).toBeNull();

    session(null);
    expect(await logoutRedirectFor("s1", req)).toBeNull();
    expect(await logoutRedirectFor(undefined, req)).toBeNull();

    disposers.pop()!();
    method(async () => {
      throw new Error("down");
    });
    session({ sub: "u", methodId: "sso-test" });
    expect(await logoutRedirectFor("s1", req)).toBeNull();
  });

  it("keeps only http and https addresses", () => {
    expect(safeRedirect("https://a.example/x")).toBe("https://a.example/x");
    expect(safeRedirect("data:text/html,hi")).toBeNull();
    expect(safeRedirect("not a url")).toBeNull();
    expect(safeRedirect(42)).toBeNull();
  });
});
