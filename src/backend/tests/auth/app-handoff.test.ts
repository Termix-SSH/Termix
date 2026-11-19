import crypto from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ valid: true }));

vi.mock("../../auth/core-auth.js", () => ({
  ensureCoreLoginProviders: vi.fn(),
}));
vi.mock("../../auth/login-pipeline.js", () => ({}));
vi.mock("../../auth/registry.js", () => ({
  getLoginMethod: vi.fn(),
  listLoginMethods: () => [],
  listSecondFactors: () => [],
}));
vi.mock("../../auth/login-descriptors.js", () => ({}));
vi.mock("../../utils/trusted-proxy-auth.js", () => ({
  isTrustedProxyAuthEnabled: () => false,
}));
vi.mock("../../auth/policy.js", () => ({
  rememberDeviceAllowed: async () => true,
}));
vi.mock("../../utils/logger.js", () => ({
  authLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      verifyJWTToken: async () => (h.valid ? { userId: "u1" } : null),
    }),
  },
}));

import {
  appChallengeOf,
  clearAppHandoffs,
  createAppHandoff,
  redeemAppHandoff,
} from "../../auth/app-handoff.js";
import { registerAuthRoutes } from "../../database/routes/auth-routes.js";

const verifier = "v".repeat(43);
const challenge = crypto
  .createHash("sha256")
  .update(verifier)
  .digest("base64url");

beforeEach(() => {
  clearAppHandoffs();
  h.valid = true;
});

describe("app hand-off codes", () => {
  it("gives the session to the holder of the verifier, once", () => {
    const code = createAppHandoff("jwt-1", challenge);
    expect(redeemAppHandoff(code, verifier)).toBe("jwt-1");
    expect(redeemAppHandoff(code, verifier)).toBeNull();
  });

  it("refuses a wrong verifier and burns the code", () => {
    const code = createAppHandoff("jwt-1", challenge);
    expect(redeemAppHandoff(code, "w".repeat(43))).toBeNull();
    expect(redeemAppHandoff(code, verifier)).toBeNull();
  });

  it("refuses an expired code", () => {
    const code = createAppHandoff("jwt-1", challenge, 1000);
    expect(redeemAppHandoff(code, verifier, 1000 + 2 * 60 * 1000)).toBeNull();
  });

  it("refuses junk input", () => {
    expect(redeemAppHandoff(undefined, verifier)).toBeNull();
    expect(redeemAppHandoff("x", 42)).toBeNull();
    expect(redeemAppHandoff("x", "short")).toBeNull();
  });

  it("reads only a well formed challenge header", () => {
    const req = (value?: string) =>
      ({ get: () => value }) as unknown as express.Request;
    expect(appChallengeOf(req(challenge))).toBe(challenge);
    expect(appChallengeOf(req("nope"))).toBeNull();
    expect(appChallengeOf(req())).toBeNull();
  });
});

describe("POST /users/auth/app-handoff/redeem", () => {
  let close: () => Promise<void>;
  let url: string;

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerAuthRoutes(router);
    app.use("/users", router);
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/users/auth/app-handoff/redeem`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });

  afterEach(() => close());

  const redeem = (body: unknown) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("answers with the token", async () => {
    const code = createAppHandoff("jwt-1", challenge);
    const res = await redeem({ code, verifier });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ token: "jwt-1" });
  });

  it("refuses a wrong verifier", async () => {
    const code = createAppHandoff("jwt-1", challenge);
    const res = await redeem({ code, verifier: "w".repeat(43) });
    expect(res.status).toBe(400);
  });

  it("refuses a session that ended meanwhile", async () => {
    h.valid = false;
    const code = createAppHandoff("jwt-1", challenge);
    const res = await redeem({ code, verifier });
    expect(res.status).toBe(400);
  });
});
