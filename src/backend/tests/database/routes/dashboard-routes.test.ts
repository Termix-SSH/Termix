import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

const state = vi.hoisted(() => ({
  unlocked: true,
  activity: [] as unknown[],
  recordResult: { status: "logged", id: 1 } as {
    status: string;
    id?: number;
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  dashboardLogger: { warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () => (req: express.Request, _res: unknown, next: () => void) => {
          (req as unknown as { userId: string }).userId = "user-1";
          next();
        },
    }),
  },
}));

vi.mock("../../../utils/data-crypto.js", () => ({
  DataCrypto: {
    getUserDataKey: () => (state.unlocked ? "key" : null),
  },
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentRecentActivityRepository: () => ({
    listByUserId: async () => state.activity,
    deleteByUserId: async () => {},
  }),
}));

vi.mock("../../../services/recent-activity.js", () => ({
  recordRecentActivity: async () => state.recordResult,
}));

const { default: dashboardRoutes } =
  await import("../../../database/routes/dashboard-routes.js");

let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  state.unlocked = true;
  state.activity = [];
  state.recordResult = { status: "logged", id: 1 };

  const app = express();
  app.use(express.json());
  app.use("/dashboard", dashboardRoutes);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /dashboard/uptime", () => {
  it("returns a formatted uptime", async () => {
    const res = await fetch(`${baseUrl}/dashboard/uptime`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      uptimeMs: expect.any(Number),
      formatted: expect.stringMatching(/^\d+d \d+h \d+m$/),
    });
  });
});

describe("GET /dashboard/activity/recent", () => {
  it("401s when the user's data key is not unlocked", async () => {
    state.unlocked = false;
    const res = await fetch(`${baseUrl}/dashboard/activity/recent`);
    expect(res.status).toBe(401);
  });

  it("returns the user's recent activity", async () => {
    state.activity = [{ id: 1, type: "terminal" }];
    const res = await fetch(`${baseUrl}/dashboard/activity/recent`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(state.activity);
  });
});

describe("POST /dashboard/activity/log", () => {
  it("rejects a body missing required fields", async () => {
    const res = await fetch(`${baseUrl}/dashboard/activity/log`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "terminal" }),
    });
    expect(res.status).toBe(400);
  });

  it("logs a valid activity", async () => {
    const res = await fetch(`${baseUrl}/dashboard/activity/log`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "terminal", hostId: 1, hostName: "prod" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Activity logged", id: 1 });
  });

  it("404s a host the user cannot access", async () => {
    state.recordResult = { status: "denied" };
    const res = await fetch(`${baseUrl}/dashboard/activity/log`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "terminal", hostId: 1, hostName: "prod" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /dashboard/activity/reset", () => {
  it("clears the user's recent activity", async () => {
    const res = await fetch(`${baseUrl}/dashboard/activity/reset`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Recent activity cleared" });
  });
});
