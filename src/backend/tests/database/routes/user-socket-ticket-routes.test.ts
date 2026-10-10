/**
 * The web app's socket ticket. The cookie rides along from a sibling
 * subdomain too, so a ticket only goes to a page on this server.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { AuthManager } from "../../../utils/auth-manager.js";

const state = vi.hoisted(() => ({
  sessionId: "s1" as string | undefined,
  apiKeyId: undefined as string | undefined,
}));

vi.mock("../../../utils/logger.js", () => ({
  authLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { registerUserSocketTicketRoutes } =
  await import("../../../database/routes/user-socket-ticket-routes.js");

const issueSocketTicket = vi.fn(
  async (userId: string, sessionId: string) => `ticket:${userId}:${sessionId}`,
);

const authenticate: RequestHandler = (req, _res, next) => {
  Object.assign(req, {
    userId: "u1",
    sessionId: state.sessionId,
    apiKeyId: state.apiKeyId,
  });
  next();
};

function app() {
  const router = express.Router();
  registerUserSocketTicketRoutes(router, {
    authenticateJWT: authenticate,
    authManager: { issueSocketTicket } as unknown as AuthManager,
  });
  const server = express();
  server.use(cookieParser());
  server.use("/users", router);
  return server;
}

beforeEach(() => {
  state.sessionId = "s1";
  state.apiKeyId = undefined;
  issueSocketTicket.mockClear();
});

describe("POST /users/ws-ticket", () => {
  it("gives this server's own page a ticket for its session", async () => {
    const res = await request(app())
      .post("/users/ws-ticket")
      .set("Host", "termix.example.com")
      .set("Origin", "https://termix.example.com")
      .set("Cookie", "jwt=session-token");

    expect(res.status).toBe(200);
    expect(res.body.ticket).toBe("ticket:u1:s1");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("trusts the browser's same-origin mark behind a proxy that rewrites Host", async () => {
    const res = await request(app())
      .post("/users/ws-ticket")
      .set("Host", "10.0.0.5:8080")
      .set("Origin", "https://termix.example.com")
      .set("Sec-Fetch-Site", "same-origin")
      .set("Cookie", "jwt=session-token");

    expect(res.status).toBe(200);
  });

  it("refuses a page on a sibling subdomain", async () => {
    const res = await request(app())
      .post("/users/ws-ticket")
      .set("Host", "termix.example.com")
      .set("Origin", "https://evil.example.com")
      .set("Sec-Fetch-Site", "same-site")
      .set("Cookie", "jwt=session-token");

    expect(res.status).toBe(403);
    expect(issueSocketTicket).not.toHaveBeenCalled();
  });

  it("refuses an API key, which has no session to bind to", async () => {
    state.sessionId = undefined;
    state.apiKeyId = "key-1";

    const res = await request(app()).post("/users/ws-ticket");

    expect(res.status).toBe(401);
    expect(issueSocketTicket).not.toHaveBeenCalled();
  });
});
