/**
 * The admin host defaults. The terminal half moved to the ssh-terminal
 * plugin's new-host settings; its keys stay in the stored row for the boot
 * copy and a downgrade, but are never served or overwritten here.
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
vi.mock("../../../utils/analytics.js", () => ({
  getTelemetryEnvOverride: () => null,
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
  it("serves core's defaults without the terminal keys the plugin took over", async () => {
    state.settings.host_defaults = JSON.stringify({
      useSocks5: true,
      fontSize: 18,
      autoTmux: true,
    });
    const response = await request(app()).get("/users/host-defaults");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ useSocks5: true });
  });

  it("keeps the stored terminal keys when an admin saves core's defaults", async () => {
    state.settings.host_defaults = JSON.stringify({
      useSocks5: true,
      fontSize: 18,
      enableCommandHistory: false,
    });
    const response = await request(app())
      .patch("/users/host-defaults")
      .send({ useSocks5: false, statusCheckEnabled: false, autoTmux: true });
    expect(response.status).toBe(200);
    expect(JSON.parse(state.settings.host_defaults)).toEqual({
      fontSize: 18,
      enableCommandHistory: false,
      useSocks5: false,
      statusCheckEnabled: false,
    });
  });

  it("refuses a user who is not an admin", async () => {
    state.admin = false;
    const response = await request(app())
      .patch("/users/host-defaults")
      .send({ useSocks5: true });
    expect(response.status).toBe(403);
  });
});
