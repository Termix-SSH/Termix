import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, RequestHandler, Response } from "express";
import { TOUCH_INPUT_DEFAULTS } from "../../../../types/touch-input-settings.js";

const state = vi.hoisted(() => ({
  userId: "admin",
  admins: new Set(["admin"]),
  stored: null as string | null,
}));

vi.mock("../../../utils/logger.js", () => ({
  authLogger: { error: vi.fn() },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentUserRepository: () => ({
    findById: async (id: string) => ({ id, isAdmin: state.admins.has(id) }),
  }),
  createCurrentSettingsRepository: () => ({
    get: async () => state.stored,
    set: async (_key: string, value: string) => {
      state.stored = value;
    },
  }),
}));

const { registerTouchInputSettingsRoutes } =
  await import("../../../database/routes/touch-input-settings-routes.js");

type Registered = { method: string; path: string; handler: RequestHandler };
const registered: Registered[] = [];
const router = {
  get: (path: string, ...handlers: RequestHandler[]) =>
    registered.push({ method: "get", path, handler: handlers.at(-1)! }),
  patch: (path: string, ...handlers: RequestHandler[]) =>
    registered.push({ method: "patch", path, handler: handlers.at(-1)! }),
} as unknown as import("express").Router;
registerTouchInputSettingsRoutes(router, (_req, _res, next) => next());

async function invoke(method: string, body: unknown = {}) {
  const handler = registered.find((entry) => entry.method === method)!.handler;
  const req = { userId: state.userId, body } as unknown as Request;
  const result = { statusCode: 200, body: null as unknown };
  const res = {
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(bodyValue: unknown) {
      result.body = bodyValue;
      return this;
    },
  } as Response;
  await handler(req, res, () => {});
  return result;
}

beforeEach(() => {
  state.userId = "admin";
  state.stored = null;
});

describe("touch input settings routes", () => {
  it("allows authenticated non-admin users to read normalized defaults", async () => {
    state.userId = "user";
    const response = await invoke("get");
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(TOUCH_INPUT_DEFAULTS);
  });

  it("only allows admins to write", async () => {
    state.userId = "user";
    const response = await invoke("patch", { enabled: false });
    expect(response.statusCode).toBe(403);
    expect(state.stored).toBeNull();
  });

  it("rejects out-of-range values and persists normalized updates", async () => {
    const invalid = await invoke("patch", { maximumTicksPerFrame: 101 });
    expect(invalid.statusCode).toBe(400);

    const valid = await invoke("patch", {
      dragThresholdPx: 9,
      momentumEnabled: false,
    });
    expect(valid.statusCode).toBe(200);
    expect(JSON.parse(state.stored!)).toEqual({
      ...TOUCH_INPUT_DEFAULTS,
      dragThresholdPx: 9,
      momentumEnabled: false,
    });
  });
});
