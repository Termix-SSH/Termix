import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import {
  apiKeyFailureWait,
  CORE_RATE_LIMITS,
  hit,
  rateLimitMiddleware,
  recordApiKeyFailure,
  resetRateLimits,
} from "../../utils/rate-limit.js";

function app() {
  const server = express();
  server.use(express.json());
  server.use(cookieParser());
  server.use(rateLimitMiddleware(CORE_RATE_LIMITS));
  server.all(/.*/, (_req, res) => {
    res.json({ ok: true });
  });
  return server;
}

async function flood(
  server: express.Express,
  times: number,
  send: () => request.Test,
): Promise<number[]> {
  const codes: number[] = [];
  for (let i = 0; i < times; i++) codes.push((await send()).status);
  void server;
  return codes;
}

beforeEach(() => resetRateLimits());

describe("rate limits", () => {
  it("counts in a fixed window and says how long to wait", () => {
    const limit = { max: 2, windowMs: 10_000 };
    expect(hit("k", limit, 0)).toBe(0);
    expect(hit("k", limit, 1)).toBe(0);
    expect(hit("k", limit, 2)).toBe(10);
    expect(hit("k", limit, 10_001)).toBe(0);
  });

  it("stops login floods against one account", async () => {
    const server = app();
    const codes = await flood(server, 12, () =>
      request(server).post("/users/login").send({ username: "Admin" }),
    );
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);

    const other = await request(server)
      .post("/users/login")
      .send({ username: "someone" });
    expect(other.status).toBe(200);
  });

  it("matches plugin login methods and answers with Retry-After", async () => {
    const server = app();
    let last: request.Response | null = null;
    for (let i = 0; i < 11; i++) {
      last = await request(server)
        .post("/users/ldap/login")
        .send({ username: "a" });
    }
    expect(last!.status).toBe(429);
    expect(Number(last!.headers["retry-after"])).toBeGreaterThan(0);
    expect(last!.body.code).toBe("RATE_LIMITED");
  });

  it("limits password reset per IP", async () => {
    const server = app();
    const codes = await flood(server, 21, () =>
      request(server)
        .post("/users/initiate-reset")
        .send({ username: `user${Math.random()}` }),
    );
    expect(codes[20]).toBe(429);
  });

  it("limits exports per session", async () => {
    const server = app();
    const codes = await flood(server, 11, () =>
      request(server)
        .post("/database/export")
        .set("Authorization", "Bearer token-a"),
    );
    expect(codes[10]).toBe(429);
    const otherSession = await request(server)
      .post("/database/export")
      .set("Authorization", "Bearer token-b");
    expect(otherSession.status).toBe(200);
  });

  it("limits API key creation per session", async () => {
    const server = app();
    const codes = await flood(server, 21, () =>
      request(server)
        .post("/users/api-keys")
        .set("Authorization", "Bearer token-a"),
    );
    expect(codes[20]).toBe(429);
  });

  it("leaves other routes alone", async () => {
    const server = app();
    const codes = await flood(server, 50, () =>
      request(server).get("/host/db/host"),
    );
    expect(codes.every((c) => c === 200)).toBe(true);
  });

  it("blocks an IP after too many bad API keys", () => {
    for (let i = 0; i < 19; i++) recordApiKeyFailure("10.9.9.9");
    expect(apiKeyFailureWait("10.9.9.9")).toBe(0);
    recordApiKeyFailure("10.9.9.9");
    expect(apiKeyFailureWait("10.9.9.9")).toBeGreaterThan(0);
    expect(apiKeyFailureWait("10.9.9.8")).toBe(0);
  });
});
