/**
 * The embedded desktop backend hands out a session without a password, so
 * only the desktop app itself may ask for one. A web page open in a browser
 * on the same machine must never get it, whatever name it reaches us by.
 */

import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCorsMiddleware } from "../../utils/cors-config.js";
import {
  embeddedHostGuard,
  isEmbeddedHostAllowed,
} from "../../utils/embedded-host.js";
import { desktopAutoSessionRefusal } from "../../database/routes/desktop-auto-session.js";

const PORT = 30001;

function makeApp() {
  const app = express();
  app.use(embeddedHostGuard);
  app.use(createCorsMiddleware());
  app.post("/users/internal/auto-session", (req, res) => {
    if (desktopAutoSessionRefusal(req)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json({ token: "minted" });
  });
  return app;
}

const call = (headers: Record<string, string>) => {
  let r = request(makeApp()).post("/users/internal/auto-session");
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r;
};

const APP = { Host: `127.0.0.1:${PORT}`, "X-Electron-App": "true" };

beforeEach(() => {
  vi.stubEnv("ELECTRON_EMBEDDED", "true");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("EMBEDDED_BACKEND_PORT", String(PORT));
  vi.stubEnv("CORS_ALLOWED_ORIGINS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GHSA-frx8-qqgg-7j7g desktop auto-session stays with the app", () => {
  it("gives the desktop app its session", async () => {
    const res = await call({
      ...APP,
      Origin: "app://termix",
      "Sec-Fetch-Site": "cross-site",
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe("minted");
  });

  it("refuses a foreign origin and never allows it to read the answer", async () => {
    const res = await call({ ...APP, Origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.body.token).toBeUndefined();
  });

  it("refuses a page that reaches loopback through its own DNS name", async () => {
    const res = await call({
      ...APP,
      Host: `rebind.evil.example:${PORT}`,
      Origin: `http://rebind.evil.example:${PORT}`,
    });
    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
  });

  it("refuses a rebinding name even with no Origin header", async () => {
    const res = await call({ ...APP, Host: `rebind.evil.example:${PORT}` });
    expect(res.status).toBe(403);
  });

  it("refuses a plain form post with no app header", async () => {
    const res = await call({ Host: `127.0.0.1:${PORT}` });
    expect(res.status).toBe(403);
  });

  it("refuses an opaque origin", async () => {
    const res = await call({ ...APP, Origin: "null" });
    expect(res.status).toBe(403);
  });

  it("refuses a cross-site fetch even when it claims to be the app", async () => {
    const res = await call({ ...APP, "Sec-Fetch-Site": "cross-site" });
    expect(res.status).toBe(403);
  });

  it("refuses the old file:// origin", async () => {
    const res = await call({ ...APP, Origin: "file://" });
    expect(res.status).toBe(403);
  });
});

describe("isEmbeddedHostAllowed", () => {
  it.each([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`])(
    "accepts %s",
    (host) => expect(isEmbeddedHostAllowed(host, PORT)).toBe(true),
  );

  it.each([
    undefined,
    "",
    "127.0.0.1",
    `127.0.0.1:${PORT + 1}`,
    `evil.example:${PORT}`,
    `127.0.0.1.evil.example:${PORT}`,
    `LOCALHOST:${PORT}`,
    `localhost:${PORT}@evil.example`,
  ])("refuses %s", (host) => {
    expect(isEmbeddedHostAllowed(host, PORT)).toBe(false);
  });
});
