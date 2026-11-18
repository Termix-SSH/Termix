import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { TestSqliteDatabase } from "../repositories/test-support.js";
import { ApiKeyRepository } from "../../../database/repositories/api-key-repository.js";
import { SessionRepository } from "../../../database/repositories/session-repository.js";

import type { DatabaseContext } from "../../../database/repositories/database-context.js";

const h = vi.hoisted(() => ({
  context: null as DatabaseContext | null,
  caller: "alice",
  sessionId: "s-alice",
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../database/repositories/factory.js", async () => {
  const { ApiKeyRepository } =
    await import("../../../database/repositories/api-key-repository.js");
  const { SessionRepository } =
    await import("../../../database/repositories/session-repository.js");
  const { UserRepository } =
    await import("../../../database/repositories/user-repository.js");
  return {
    createCurrentApiKeyRepository: () => new ApiKeyRepository(h.context!),
    createCurrentSessionRepository: () => new SessionRepository(h.context!),
    createCurrentUserRepository: () => new UserRepository(h.context!),
  };
});
vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    h.audits.push(entry);
  },
  getAuditUsername: async (id: string) => id,
  getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

const { registerUserApiKeyRoutes } =
  await import("../../../database/routes/user-api-key-routes.js");
const { registerUserSessionRoutes } =
  await import("../../../database/routes/user-session-routes.js");

const authenticate: express.RequestHandler = (req, _res, next) => {
  Object.assign(req, { userId: h.caller, sessionId: h.sessionId });
  next();
};
const requireAdmin: express.RequestHandler = (req, res, next) => {
  if (h.caller !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  authenticate(req, res, next);
};

let server: Server;
let baseUrl: string;
let adapter: TestSqliteDatabase;

beforeAll(async () => {
  const router = express.Router();
  registerUserApiKeyRoutes(router, requireAdmin, authenticate);
  registerUserSessionRoutes(router, {
    authenticateJWT: authenticate,
    authManager: {} as never,
  });
  const app = express();
  app.use(express.json());
  app.use("/users", router);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/users`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(async () => {
  adapter = new TestSqliteDatabase();
  h.context = await adapter.connect();
  await adapter.exec(`
    INSERT INTO users (id, username, password_hash, is_admin)
    VALUES ('admin', 'admin', 'h', 1), ('alice', 'alice', 'h', 0), ('bob', 'bob', 'h', 0);
  `);
  const keys = new ApiKeyRepository(h.context);
  for (const [id, userId] of [
    ["k-alice-1", "alice"],
    ["k-alice-2", "alice"],
    ["k-bob", "bob"],
  ]) {
    await keys.create({
      id,
      userId,
      name: id,
      tokenHash: "secret-hash",
      tokenPrefix: "tmx_abc",
      createdAt: new Date().toISOString(),
      isActive: true,
    });
  }
  const sessions = new SessionRepository(h.context);
  for (const [id, userId] of [
    ["s-admin", "admin"],
    ["s-alice", "alice"],
    ["s-bob", "bob"],
  ]) {
    await sessions.create({
      id,
      userId,
      jwtToken: "t",
      deviceType: "web",
      deviceInfo: "test",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
  }
  h.caller = "alice";
  h.sessionId = "s-alice";
  h.audits = [];
});

afterEach(async () => {
  await adapter.close();
});

const keyIds = async () =>
  (await new ApiKeyRepository(h.context!).listAllWithUsers()).map((k) => k.id);

describe("own API keys", () => {
  it("lists only the caller's keys, without hashes", async () => {
    const res = await fetch(`${baseUrl}/api-keys/mine`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apiKeys.map((k: { id: string }) => k.id).sort()).toEqual([
      "k-alice-1",
      "k-alice-2",
    ]);
    expect(JSON.stringify(body)).not.toContain("secret-hash");
    expect(body.apiKeys[0]).toHaveProperty("lastUsedAt");
  });

  it("revokes one of the caller's keys", async () => {
    const res = await fetch(`${baseUrl}/api-keys/mine/k-alice-1`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(await keyIds()).toEqual(["k-alice-2", "k-bob"]);
  });

  it("answers 404 for someone else's key and leaves it", async () => {
    const res = await fetch(`${baseUrl}/api-keys/mine/k-bob`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect(await keyIds()).toContain("k-bob");
  });

  it("revokes all of the caller's keys only", async () => {
    const res = await fetch(`${baseUrl}/api-keys/mine/revoke-all`, {
      method: "POST",
    });
    expect(await res.json()).toEqual({ count: 2 });
    expect(await keyIds()).toEqual(["k-bob"]);
    expect(h.audits[0]).toMatchObject({ action: "revoke_all_api_keys" });
  });
});

describe("creating keys", () => {
  beforeEach(() => {
    h.caller = "admin";
    h.sessionId = "s-admin";
  });

  const create = (body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api-keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ci", userId: "alice", ...body }),
    });

  it("is read only and lasts 90 days unless asked otherwise", async () => {
    const res = await create({});
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.scopes).toEqual(["read"]);
    const days = (Date.parse(body.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
  });

  it("treats null scopes like the default", async () => {
    const body = await (await create({ scopes: null })).json();
    expect(body.scopes).toEqual(["read"]);
  });

  it("gives full access and no expiry only when asked", async () => {
    const body = await (
      await create({ scopes: ["full"], expiresAt: null })
    ).json();
    expect(body.scopes).toBeNull();
    expect(body.expiresAt).toBeNull();
  });

  it("refuses full mixed with other scopes and unknown scopes", async () => {
    expect((await create({ scopes: ["full", "read"] })).status).toBe(400);
    expect((await create({ scopes: ["admin"] })).status).toBe(400);
  });

  it("is admin only", async () => {
    h.caller = "alice";
    expect((await create({})).status).toBe(403);
  });
});

describe("signing everyone out", () => {
  it("is admin only", async () => {
    const res = await fetch(`${baseUrl}/sessions/revoke-everyone`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  it("ends every session but the caller's, and keys when asked", async () => {
    h.caller = "admin";
    h.sessionId = "s-admin";
    const res = await fetch(`${baseUrl}/sessions/revoke-everyone`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKeys: true }),
    });
    expect(await res.json()).toEqual({ sessions: 2, apiKeys: 3 });
    const left = await new SessionRepository(h.context!).listAll();
    expect(left.map((s) => s.id)).toEqual(["s-admin"]);
    expect(await keyIds()).toEqual([]);
    expect(h.audits[0]).toMatchObject({ action: "revoke_everyone_sessions" });
  });

  it("keeps API keys unless asked", async () => {
    h.caller = "admin";
    h.sessionId = "s-admin";
    await fetch(`${baseUrl}/sessions/revoke-everyone`, { method: "POST" });
    expect(await keyIds()).toHaveLength(3);
  });
});
