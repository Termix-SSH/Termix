import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  globalMarks: 0,
  userMarks: [] as string[],
  localWrites: 0,
}));

vi.mock("../../../sync/server/feed.js", () => ({
  markChanged: () => {
    state.globalMarks++;
  },
  markUserChanged: (userId: string) => {
    state.userMarks.push(userId);
  },
}));

vi.mock("../../../sync/server/write-listeners.js", () => ({
  notifyLocalWrite: () => {
    state.localWrites++;
  },
}));

const { syncChangeWatcher, isGlobalChangePath } =
  await import("../../../sync/server/change-watcher.js");

function runWatcher(options: {
  method: string;
  path: string;
  statusCode?: number;
  userId?: string;
  actingAdminUserId?: string;
}): void {
  const req = {
    method: options.method,
    path: options.path,
  } as Request & { userId?: string; actingAdminUserId?: string };

  const res = new EventEmitter() as EventEmitter & { statusCode: number };
  res.statusCode = options.statusCode ?? 200;

  let nextCalled = false;
  syncChangeWatcher(req, res as unknown as Response, () => {
    nextCalled = true;
    // Simulate downstream auth middleware attaching userId after watcher runs.
    if (options.userId !== undefined) req.userId = options.userId;
    if (options.actingAdminUserId !== undefined) {
      req.actingAdminUserId = options.actingAdminUserId;
    }
  });
  expect(nextCalled).toBe(true);
  res.emit("finish");
}

beforeEach(() => {
  state.globalMarks = 0;
  state.userMarks = [];
  state.localWrites = 0;
});

describe("syncChangeWatcher", () => {
  it("marks only the authenticated user dirty on normal write requests", () => {
    runWatcher({ method: "POST", path: "/host/123", userId: "user-a" });
    expect(state.userMarks).toEqual(["user-a"]);
    expect(state.globalMarks).toBe(0);
    expect(state.localWrites).toBe(1);
  });

  it("marks both target user and acting admin on impersonated single-user writes", () => {
    runWatcher({
      method: "PUT",
      path: "/credentials/42",
      userId: "user-target",
      actingAdminUserId: "user-admin",
    });
    expect(state.userMarks).toEqual(["user-target", "user-admin"]);
    expect(state.globalMarks).toBe(0);
    expect(state.localWrites).toBe(1);
  });

  it("falls back to global markChanged when req.userId is absent", () => {
    runWatcher({ method: "POST", path: "/host/123" });
    expect(state.globalMarks).toBe(1);
    expect(state.userMarks).toEqual([]);
    expect(state.localWrites).toBe(1);
  });

  it.each([
    "/rbac",
    "/rbac/roles/1",
    "/users/admin/u2/disable",
    "/users/admin-create",
    "/users/admin-host-bypass",
    "/users/admin-holds/settings",
    "/users/make-admin",
    "/users/remove-admin",
    "/host/share",
    "/host/share/12",
    "/host/12/share",
    "/credentials/5/share",
    "/database/restore",
    "/encryption/initialize",
    "/plugins/install",
    "/plugin-api/demo/action",
    "/version/channel",
  ])(
    "falls back to global markChanged for cross-user/admin route %s",
    (path) => {
      expect(isGlobalChangePath(path)).toBe(true);
      runWatcher({ method: "POST", path, userId: "user-a" });
      expect(state.globalMarks).toBe(1);
      expect(state.userMarks).toEqual([]);
      expect(state.localWrites).toBe(1);
    },
  );

  it("ignores reads, /sync/ routes, and error responses", () => {
    runWatcher({ method: "GET", path: "/host/123", userId: "user-a" });
    runWatcher({ method: "HEAD", path: "/host/123", userId: "user-a" });
    runWatcher({ method: "OPTIONS", path: "/host/123", userId: "user-a" });
    runWatcher({ method: "POST", path: "/sync/push", userId: "user-a" });
    runWatcher({
      method: "POST",
      path: "/host/123",
      statusCode: 400,
      userId: "user-a",
    });
    runWatcher({
      method: "DELETE",
      path: "/rbac/roles/1",
      statusCode: 500,
      userId: "user-a",
    });
    expect(state.globalMarks).toBe(0);
    expect(state.userMarks).toEqual([]);
    expect(state.localWrites).toBe(0);
  });
});
