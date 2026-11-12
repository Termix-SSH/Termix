import { describe, expect, it } from "vitest";
import crypto from "crypto";
import express from "express";
import request from "supertest";
import {
  API_CSP,
  appCsp,
  COMMON_HEADERS,
  desktopMetaCsp,
  HSTS_VALUE,
  importMapHashFromHtml,
  PLUGIN_CSP,
  securityHeadersMiddleware,
  setAppShellHeaders,
} from "../../http/security-headers.js";

const HASH = "'sha256-test'";

function app() {
  const server = express();
  server.set("trust proxy", "loopback");
  server.use(securityHeadersMiddleware());
  server.get("/users/me", (_req, res) => res.json({ ok: true }));
  server.get("/plugin-api/demo/page", (_req, res) => res.send("page"));
  server.get("/plugin-api/demo/own-csp", (_req, res) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'");
    res.send("page");
  });
  server.get("/", (_req, res) => {
    setAppShellHeaders(res, HASH);
    res.send("<html></html>");
  });
  return server;
}

describe("security headers", () => {
  it("sends the common headers on every response", async () => {
    const res = await request(app()).get("/users/me");
    for (const [name, value] of Object.entries(COMMON_HEADERS)) {
      expect(res.headers[name.toLowerCase()]).toBe(value);
    }
  });

  it("locks core API responses down", async () => {
    const res = await request(app()).get("/users/me");
    expect(res.headers["content-security-policy"]).toBe(API_CSP);
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("serves the app shell with its policy and the import map hash", async () => {
    const res = await request(app()).get("/");
    const csp = res.headers["content-security-policy"];
    expect(csp).toBe(appCsp(HASH));
    expect(csp).toContain(`script-src 'self' 'wasm-unsafe-eval' ${HASH}`);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("gives plugin routes a default they can replace", async () => {
    const plain = await request(app()).get("/plugin-api/demo/page");
    expect(plain.headers["content-security-policy"]).toBe(PLUGIN_CSP);
    expect(plain.headers["x-frame-options"]).toBeUndefined();

    const own = await request(app()).get("/plugin-api/demo/own-csp");
    expect(own.headers["content-security-policy"]).toBe("default-src 'self'");
  });

  it("sends HSTS only over HTTPS", async () => {
    const plain = await request(app()).get("/users/me");
    expect(plain.headers["strict-transport-security"]).toBeUndefined();

    const proxied = await request(app())
      .get("/users/me")
      .set("X-Forwarded-Proto", "https");
    expect(proxied.headers["strict-transport-security"]).toBe(HSTS_VALUE);
  });

  it("hashes the inline import map the way the browser does", () => {
    const map = '{"imports":{"react":"./shared/react.js"}}';
    const html = `<head><script type="importmap">${map}</script></head>`;
    const digest = crypto.createHash("sha256").update(map).digest("base64");
    expect(importMapHashFromHtml(html)).toBe(`'sha256-${digest}'`);
    expect(importMapHashFromHtml("<head></head>")).toBeNull();
  });

  it("gives the desktop meta policy the local backend and no frame-ancestors", () => {
    const meta = desktopMetaCsp(HASH);
    expect(meta).toMatch(/script-src [^;]*http:\/\/localhost:\*/);
    expect(meta).toContain(HASH);
    // Ignored in a meta tag, and the header policy carries it.
    expect(meta).not.toContain("frame-ancestors");
    expect(meta).toContain("object-src 'none'");
  });
});
