import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (req: Record<string, unknown>, _res: unknown, next: () => void) => {
          req.userId = "u1";
          next();
        },
    }),
  },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentOpenTabRepository: () => ({}),
}));
// The terminal runs in its own process, so its service answers with Promises.
vi.mock("../../../plugins/service-registry.js", () => ({
  getServiceImplementation: () => ({
    listForUser: async (userId: string) => [
      {
        id: "s1",
        userId,
        hostId: 9,
        hostName: "Testing",
        tabInstanceId: "t1",
        isConnected: true,
        createdAt: 5,
      },
    ],
    idleTimeoutMinutes: async () => 45,
  }),
}));

const { default: router } =
  await import("../../../database/routes/open-tabs.js");

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use("/open-tabs", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/open-tabs`;
});

afterAll(() => server.close());

describe("open tabs with a terminal in its own process", () => {
  it("lists the caller's live sessions", async () => {
    const res = await fetch(`${base}/active-sessions`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        sessionId: "s1",
        hostId: 9,
        hostName: "Testing",
        tabInstanceId: "t1",
        isConnected: true,
        createdAt: 5,
      },
    ]);
  });

  it("uses the terminal's idle timeout", async () => {
    const res = await fetch(`${base}/session-timeout`);
    expect(await res.json()).toEqual({ minutes: 45 });
  });
});
