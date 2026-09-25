/**
 * POST /notification-channels/:id/test sends through deliverNotification,
 * the same path an automation's notify step takes.
 */

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  deliver: vi.fn(),
  channel: null as null | { id: number; type: string; config: string },
}));

vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () => (req: { userId?: string }, _res: unknown, next: () => void) => {
          req.userId = "user-1";
          next();
        },
    }),
  },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentNotificationChannelRepository: () => ({
    findNotificationChannelForUser: async () => h.channel,
  }),
}));
vi.mock("../../../utils/notification-sender.js", () => ({
  deliverNotification: h.deliver,
}));

const { default: router } =
  await import("../../../database/routes/notification-channels-routes.js");
const app = express().use(express.json()).use(router);

beforeEach(() => {
  h.deliver.mockReset();
  h.channel = { id: 3, type: "ntfy", config: '{"url":"https://ntfy.sh"}' };
});

describe("POST /notification-channels/:id/test", () => {
  it("delivers a test notification to the channel", async () => {
    h.deliver.mockResolvedValue(undefined);
    const response = await request(app).post("/notification-channels/3/test");
    expect(response.body).toEqual({ success: true });
    expect(h.deliver).toHaveBeenCalledWith(
      h.channel,
      expect.objectContaining({ severity: "info" }),
    );
  });

  it("reports the delivery error", async () => {
    h.deliver.mockRejectedValue(new Error("ntfy channel is missing a topic"));
    const response = await request(app).post("/notification-channels/3/test");
    expect(response.body).toEqual({
      success: false,
      error: "ntfy channel is missing a topic",
    });
  });

  it("answers 404 for a channel the user does not own", async () => {
    h.channel = null;
    const response = await request(app).post("/notification-channels/9/test");
    expect(response.status).toBe(404);
  });
});
