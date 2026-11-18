import { describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import {
  clearAuthCookie,
  cookieNameFor,
  normalizeCookieHeader,
  normalizeCookiesMiddleware,
  setAuthCookie,
} from "../../auth/session-cookie.js";

const OPTIONS = {
  httpOnly: true,
  secure: false,
  sameSite: "lax" as const,
  path: "/",
};

function app() {
  const server = express();
  server.set("trust proxy", "loopback");
  server.use(normalizeCookiesMiddleware);
  server.use(cookieParser());
  server.post("/login", (req, res) => {
    setAuthCookie(req, res, "jwt", "token-1", {
      ...OPTIONS,
      secure: req.headers["x-forwarded-proto"] === "https",
      maxAge: 60_000,
    }).json({ ok: true });
  });
  server.post("/logout", (req, res) => {
    clearAuthCookie(req, res, "jwt", OPTIONS).json({ ok: true });
  });
  server.get("/whoami", (req, res) => {
    res.json({ jwt: req.cookies.jwt ?? null, raw: req.headers.cookie });
  });
  return server;
}

function setCookies(res: request.Response): string[] {
  const value = res.headers["set-cookie"] as unknown;
  return Array.isArray(value) ? value : value ? [String(value)] : [];
}

describe("session cookie names", () => {
  it("keeps the plain name over HTTP", async () => {
    const res = await request(app()).post("/login");
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^jwt=token-1;/);
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("SameSite=Lax");
  });

  it("uses __Host- with Secure and Path=/ over HTTPS", async () => {
    const res = await request(app())
      .post("/login")
      .set("X-Forwarded-Proto", "https");
    const cookies = setCookies(res);
    const prefixed = cookies.find((c) => c.startsWith("__Host-jwt="));
    expect(prefixed).toBeDefined();
    expect(prefixed).toContain("Secure");
    expect(prefixed).toContain("Path=/");
    expect(prefixed).not.toMatch(/Domain=/i);
    // The plain one from before HTTPS is cleared.
    expect(cookies.some((c) => /^jwt=;/.test(c))).toBe(true);
  });

  it("clears both names on logout over HTTPS", async () => {
    const res = await request(app())
      .post("/logout")
      .set("X-Forwarded-Proto", "https");
    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith("jwt=;"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("__Host-jwt=;"))).toBe(true);
  });

  it("reads the prefixed cookie as jwt and lets it win over a planted one", async () => {
    const res = await request(app())
      .get("/whoami")
      .set("Cookie", "jwt=planted; __Host-jwt=real; other=1");
    expect(res.body.jwt).toBe("real");
    // Proxy plugins strip Termix cookies by their old names.
    expect(res.body.raw).toBe("jwt=real; other=1");
  });

  it("leaves unknown prefixed cookies and plain headers alone", () => {
    expect(normalizeCookieHeader("a=1; b=2")).toBe("a=1; b=2");
    expect(normalizeCookieHeader("__Host-other=1")).toBe("__Host-other=1");
    expect(normalizeCookieHeader("__Host-termix_trust_device=t")).toBe(
      "termix_trust_device=t",
    );
  });

  it("only prefixes the auth cookies", () => {
    const req = { secure: true, headers: {} } as express.Request;
    expect(cookieNameFor(req, "jwt")).toBe("__Host-jwt");
    expect(cookieNameFor(req, "termix_pending_login")).toBe(
      "__Host-termix_pending_login",
    );
    expect(cookieNameFor(req, "termix_sync_ring")).toBe("termix_sync_ring");
  });
});
