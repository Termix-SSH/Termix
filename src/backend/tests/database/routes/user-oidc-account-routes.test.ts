/**
 * Linking an external (SSO or LDAP) account to a password account and back.
 * The linked account keeps its sign-in identities, so it signs in through the
 * same provider afterwards; unlinking drops them.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface User {
  id: string;
  username: string;
  isAdmin: boolean;
  isOidc: boolean;
  passwordHash: string;
  oidcIdentifier?: string | null;
  clientId?: string;
}

const h = vi.hoisted(() => ({
  users: new Map<string, User>(),
  identities: [] as Array<{
    userId: string;
    providerId: string;
    subject: string;
  }>,
  deleted: [] as string[],
  revoked: [] as string[],
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentUserRepository: () => ({
    findById: async (id: string) => h.users.get(id) ?? null,
    findByUsername: async (username: string) =>
      [...h.users.values()].find((user) => user.username === username) ?? null,
    update: async (id: string, changes: Partial<User>) => {
      Object.assign(h.users.get(id)!, changes);
    },
  }),
  createCurrentUserAuthRepository: () => ({
    moveIdentities: async (from: string, to: string) => {
      for (const row of h.identities) if (row.userId === from) row.userId = to;
    },
    unlinkIdentitiesForUser: async (userId: string) => {
      h.identities = h.identities.filter((row) => row.userId !== userId);
    },
  }),
}));
vi.mock("../../../database/routes/delete-user-data.js", () => ({
  deleteUserAndRelatedData: async (userId: string) => {
    h.deleted.push(userId);
    h.users.delete(userId);
  },
}));
vi.mock("../../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave: vi.fn(async () => {}) },
}));
vi.mock("../../../utils/auth-manager.js", () => ({ AuthManager: {} }));
vi.mock("../../../utils/logger.js", () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  };
  return { authLogger: log };
});

const { registerUserOidcAccountRoutes } =
  await import("../../../database/routes/user-oidc-account-routes.js");

let server: http.Server;
let base: string;

beforeEach(async () => {
  h.users = new Map([
    [
      "admin",
      {
        id: "admin",
        username: "admin",
        isAdmin: true,
        isOidc: false,
        passwordHash: "x",
      },
    ],
    [
      "sso",
      {
        id: "sso",
        username: "alice-sso",
        isAdmin: false,
        isOidc: true,
        passwordHash: "",
        oidcIdentifier: "ldap:4:alice",
      },
    ],
    [
      "local",
      {
        id: "local",
        username: "alice",
        isAdmin: false,
        isOidc: false,
        passwordHash: "hash",
      },
    ],
  ]);
  h.identities = [{ userId: "sso", providerId: "ldap:4", subject: "alice" }];
  h.deleted = [];
  h.revoked = [];

  const router = express.Router();
  router.use(express.json());
  registerUserOidcAccountRoutes(router, {
    authenticateJWT: (req, _res, next) => {
      (req as unknown as { userId: string }).userId =
        req.header("x-user") ?? "";
      next();
    },
    authManager: {
      revokeAllUserSessions: async (userId: string) => {
        h.revoked.push(userId);
      },
      logoutUser: () => {},
    } as never,
  });
  const app = express();
  app.use("/users", router);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function post(path: string, body: unknown, user = "admin") {
  return fetch(`${base}/users${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": user },
    body: JSON.stringify(body),
  });
}

describe("linking an external account to a password account", () => {
  it("moves the identities and the old identifier, then removes the external account", async () => {
    const response = await post("/link-oidc-to-password", {
      oidcUserId: "sso",
      targetUsername: "alice",
    });
    expect(response.status).toBe(200);
    expect(h.users.get("local")).toMatchObject({
      isOidc: true,
      oidcIdentifier: "ldap:4:alice",
    });
    expect(h.identities).toEqual([
      { userId: "local", providerId: "ldap:4", subject: "alice" },
    ]);
    expect(h.revoked).toEqual(["sso"]);
    expect(h.deleted).toEqual(["sso"]);
  });

  it("is for admins only", async () => {
    const response = await post(
      "/link-oidc-to-password",
      { oidcUserId: "sso", targetUsername: "alice" },
      "local",
    );
    expect(response.status).toBe(403);
    expect(h.identities[0].userId).toBe("sso");
  });

  it("refuses a target that is not a password account", async () => {
    const response = await post("/link-oidc-to-password", {
      oidcUserId: "sso",
      targetUsername: "alice-sso",
    });
    expect(response.status).toBe(400);
  });
});

describe("unlinking", () => {
  it("drops the identities so the provider no longer signs in as the user", async () => {
    await post("/link-oidc-to-password", {
      oidcUserId: "sso",
      targetUsername: "alice",
    });
    const response = await post("/unlink-oidc-from-password", {
      userId: "local",
    });
    expect(response.status).toBe(200);
    expect(h.users.get("local")).toMatchObject({
      isOidc: false,
      oidcIdentifier: null,
    });
    expect(h.identities).toEqual([]);
  });

  it("refuses to leave an account with no way in", async () => {
    const response = await post("/unlink-oidc-from-password", {
      userId: "sso",
    });
    expect(response.status).toBe(400);
    expect(h.identities).toHaveLength(1);
  });
});
