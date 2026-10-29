import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, RequestHandler, Response } from "express";

const state = vi.hoisted(() => ({
  users: new Map<
    string,
    {
      id: string;
      username: string;
      isAdmin: boolean;
      isExternal: boolean;
      passwordHash: string;
    }
  >(),
  adminCount: 1,
  deleted: [] as string[],
}));

vi.mock("../../../database/db/index.js", () => ({ db: {} }));

vi.mock("../../../utils/logger.js", () => ({
  authLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: async (password: string, hash: string) =>
      hash === `hash:${password}`,
  },
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentUserRepository: () => ({
    findById: async (id: string) => state.users.get(id) ?? null,
    countAdmins: async () => state.adminCount,
  }),
}));

vi.mock("../../../database/routes/delete-user-data.js", () => ({
  deleteUserAndRelatedData: async (userId: string) => {
    state.deleted.push(userId);
  },
}));

const { registerUserDeleteAccountRoutes } =
  await import("../../../database/routes/user-delete-account-routes.js");

let handler: RequestHandler | null = null;
registerUserDeleteAccountRoutes(
  {
    delete: (_path: string, ...handlers: RequestHandler[]) => {
      handler = handlers[handlers.length - 1];
    },
  } as unknown as import("express").Router,
  (_req, _res, next) => next(),
);

async function deleteAccount(userId: string, body: Record<string, unknown>) {
  const req = { userId, body } as unknown as Request;
  const res = {
    statusCode: 200,
    jsonBody: null as Record<string, unknown> | null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      this.jsonBody = payload;
      return this;
    },
  };
  await handler!(req, res as unknown as Response, () => {});
  return res;
}

beforeEach(() => {
  state.adminCount = 1;
  state.deleted = [];
  state.users = new Map([
    [
      "u1",
      {
        id: "u1",
        username: "user",
        isAdmin: false,
        isExternal: false,
        passwordHash: "hash:secret",
      },
    ],
    [
      "admin1",
      {
        id: "admin1",
        username: "admin",
        isAdmin: true,
        isExternal: false,
        passwordHash: "hash:secret",
      },
    ],
    [
      "sso1",
      {
        id: "sso1",
        username: "sso",
        isAdmin: false,
        isExternal: true,
        passwordHash: "hash:secret",
      },
    ],
  ]);
});

describe("DELETE /delete-account", () => {
  it("runs the full user cleanup", async () => {
    const res = await deleteAccount("u1", { password: "secret" });
    expect(res.statusCode).toBe(200);
    expect(state.deleted).toEqual(["u1"]);
  });

  it("needs a password", async () => {
    const res = await deleteAccount("u1", {});
    expect(res.statusCode).toBe(400);
    expect(state.deleted).toEqual([]);
  });

  it("refuses a wrong password", async () => {
    const res = await deleteAccount("u1", { password: "nope" });
    expect(res.statusCode).toBe(401);
    expect(state.deleted).toEqual([]);
  });

  it("refuses external accounts", async () => {
    const res = await deleteAccount("sso1", { password: "secret" });
    expect(res.statusCode).toBe(403);
    expect(state.deleted).toEqual([]);
  });

  it("refuses the last admin", async () => {
    const res = await deleteAccount("admin1", { password: "secret" });
    expect(res.statusCode).toBe(403);
    expect(state.deleted).toEqual([]);
  });

  it("lets an admin go when another admin is left", async () => {
    state.adminCount = 2;
    const res = await deleteAccount("admin1", { password: "secret" });
    expect(res.statusCode).toBe(200);
    expect(state.deleted).toEqual(["admin1"]);
  });

  it("404s for an unknown user", async () => {
    const res = await deleteAccount("ghost", { password: "secret" });
    expect(res.statusCode).toBe(404);
  });
});
