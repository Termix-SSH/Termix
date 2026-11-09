import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  verify: vi.fn(),
  challenge: vi.fn(),
  locked: false,
  failed: vi.fn(),
  reset: vi.fn(),
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../auth/login-pipeline.js", () => ({
  evaluateSecondFactors: async () => ({
    required: [{ id: "totp", verify: h.verify, challenge: h.challenge }],
    blocked: [],
  }),
}));
vi.mock("../../../utils/login-rate-limiter.js", () => ({
  loginRateLimiter: {
    isTOTPLocked: () => ({ locked: h.locked, remainingTime: 30 }),
    recordFailedTOTPAttempt: h.failed,
    resetTOTPAttempts: h.reset,
  },
}));
vi.mock("../../../utils/audit-logger.js", () => ({
  getAuditUsername: async () => "alice",
  logAudit: async (entry: Record<string, unknown>) => {
    h.audits.push(entry);
  },
}));
vi.mock("../../../utils/logger.js", () => ({
  authLogger: { error: vi.fn() },
}));

import { clearStepUp, stepUpAt } from "../../../auth/step-up.js";
import { registerStepUpRoutes } from "../../../database/routes/step-up-routes.js";

let close: () => Promise<void>;
let base: string;

beforeEach(async () => {
  h.verify.mockReset();
  h.challenge.mockReset();
  h.failed.mockReset();
  h.reset.mockReset();
  h.locked = false;
  h.audits.length = 0;
  clearStepUp("u1");
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerStepUpRoutes(router, (req, _res, next) => {
    (req as unknown as { userId: string }).userId = "u1";
    next();
  });
  app.use("/users", router);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/users/auth/step-up`;
  close = () =>
    new Promise((resolve) => {
      server.close(() => resolve());
    });
});

afterEach(() => close());

const post = (path: string, body: unknown = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("step up routes", () => {
  it("lists the user's factors", async () => {
    const res = await fetch(`${base}/factors`);
    expect(await res.json()).toEqual({ factors: [{ id: "totp" }] });
  });

  it("records a right answer and audits it", async () => {
    h.verify.mockResolvedValue(true);
    const res = await post("/totp/verify", { code: "123456" });
    expect(res.status).toBe(200);
    expect(h.verify).toHaveBeenCalledWith("u1", { code: "123456" });
    expect(stepUpAt("u1")).not.toBeNull();
    expect(h.reset).toHaveBeenCalledWith("u1");
    expect(h.audits[0]).toMatchObject({
      action: "second_factor_step_up",
      success: true,
    });
  });

  it("does not record a wrong answer, and counts it", async () => {
    h.verify.mockResolvedValue(false);
    const res = await post("/totp/verify", { code: "000000" });
    expect(res.status).toBe(401);
    expect(stepUpAt("u1")).toBeNull();
    expect(h.failed).toHaveBeenCalledWith("u1");
    expect(h.reset).not.toHaveBeenCalled();
    expect(h.audits[0]).toMatchObject({ success: false });
  });

  it("stops after too many attempts", async () => {
    h.locked = true;
    const res = await post("/totp/verify", { code: "123456" });
    expect(res.status).toBe(429);
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("refuses a factor the user does not have", async () => {
    const res = await post("/passkey/verify");
    expect(res.status).toBe(404);
    expect(stepUpAt("u1")).toBeNull();
  });
});
