/**
 * The old admin host defaults routes are gone: host defaults live under
 * /host/defaults now. The GET used to hand the admin's proxy password to any
 * signed-in user.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import request from "supertest";

const state = vi.hoisted(() => ({
  settings: {} as Record<string, string>,
  admin: true,
}));

vi.mock("../../../utils/logger.js", () => ({
  authLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  databaseLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  getGlobalLogLevel: () => "info",
  setGlobalLogLevel: vi.fn(),
}));
vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: vi.fn(async () => {}),
  getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.settings[key] ?? null,
    set: async (key: string, value: string) => {
      state.settings[key] = value;
    },
  }),
  createCurrentUserRepository: () => ({
    findById: async (id: string) => ({
      id,
      username: "admin",
      isAdmin: state.admin,
    }),
  }),
}));

const { registerUserSettingsRoutes } =
  await import("../../../database/routes/user-settings-routes.js");

const authenticate: RequestHandler = (req, _res, next) => {
  (req as unknown as { userId: string }).userId = "u1";
  next();
};

function app() {
  const router = express.Router();
  registerUserSettingsRoutes(router, authenticate);
  const server = express();
  server.use(express.json());
  server.use("/users", router);
  return server;
}

beforeEach(() => {
  state.settings = {};
  state.admin = true;
});

describe("/users/host-defaults", () => {
  it("is no longer served, so the stored row never leaves the server", async () => {
    state.settings.host_defaults = JSON.stringify({
      useSocks5: true,
      socks5Password: "secret",
    });
    const read = await request(app()).get("/users/host-defaults");
    expect(read.status).toBe(404);
    expect(JSON.stringify(read.body)).not.toContain("secret");
    const write = await request(app())
      .patch("/users/host-defaults")
      .send({ useSocks5: false });
    expect(write.status).toBe(404);
    expect(JSON.parse(state.settings.host_defaults).useSocks5).toBe(true);
  });
});
