/**
 * The browser sends the login cookie from sibling subdomains and other ports
 * of the same host. Such a page must not change anything with it, and must not
 * read what the cookie unlocks.
 */

import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../database/repositories/factory.js", () => ({}));
vi.mock("../../utils/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { authLogger: log, databaseLogger: log, logger: log };
});

const { requestToken } = await import("../../utils/auth-manager.js");
const { createCorsMiddleware } = await import("../../utils/cors-config.js");

const HOST = "termix.example.com";
const SIBLING = "https://blog.example.com";

function makeApp() {
  const app = express();
  app.use(createCorsMiddleware());
  app.use(cookieParser());
  app.use((req, res) => {
    const { token, refused } = requestToken(req);
    if (refused) {
      res.status(403).json({ error: "Not allowed from this origin" });
      return;
    }
    res.json({ token: token ?? null });
  });
  return app;
}

function post(headers: Record<string, string>) {
  let r = request(makeApp()).post("/plugin-api/snippets").set("Host", HOST);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.type("form").send("name=x&content=id");
}

afterEach(() => {
  delete process.env.CORS_ALLOWED_ORIGINS;
});

describe("GHSA-8g3v-9q6f-mw88 same site pages can't use the login cookie", () => {
  it("refuses a change from a sibling subdomain signed in by the cookie", async () => {
    const res = await post({
      Cookie: "jwt=victim",
      Origin: SIBLING,
      "Sec-Fetch-Site": "same-site",
    });
    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
  });

  it("refuses another port of the same host", async () => {
    const res = await post({
      Cookie: "jwt=victim",
      Origin: `http://${HOST}:3000`,
    });
    expect(res.status).toBe(403);
  });

  it("allows the server's own pages, the desktop app and listed origins", async () => {
    for (const headers of [
      { "Sec-Fetch-Site": "same-origin", Origin: `https://${HOST}` },
      { Origin: `https://${HOST}` },
      { Origin: "app://termix" },
      {},
    ]) {
      const res = await post({ Cookie: "jwt=victim", ...headers });
      expect(res.status).toBe(200);
      expect(res.body.token).toBe("victim");
    }
    process.env.CORS_ALLOWED_ORIGINS = SIBLING;
    const listed = await post({ Cookie: "jwt=victim", Origin: SIBLING });
    expect(listed.body.token).toBe("victim");
  });

  it("still takes a Bearer token sent from another origin", async () => {
    const res = await post({
      Cookie: "jwt=victim",
      Authorization: "Bearer from-header",
      Origin: SIBLING,
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe("from-header");
  });

  it("never lets another origin read an answer sent with the cookie", async () => {
    const res = await request(makeApp())
      .get("/credentials")
      .set("Host", HOST)
      .set("Origin", SIBLING)
      .set("Cookie", "jwt=victim");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();

    const own = await request(makeApp())
      .get("/credentials")
      .set("Host", HOST)
      .set("Origin", `http://${HOST}`)
      .set("Cookie", "jwt=victim");
    expect(own.headers["access-control-allow-credentials"]).toBe("true");

    const desktop = await request(makeApp())
      .options("/credentials")
      .set("Host", HOST)
      .set("Origin", "app://termix")
      .set("Access-Control-Request-Method", "POST");
    expect(desktop.headers["access-control-allow-credentials"]).toBe("true");
  });
});
