/**
 * Every route that reads hosts checks hosts.view, the secret copy route too.
 * Run against a real SQLite database with a permission check that enforces.
 */

import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseContext } from "../../../database/repositories/database-context.js";

const state = vi.hoisted(() => ({
  ctx: null as null | { drizzle: unknown },
  granted: new Set<string>(),
}));

const USER = "user-1";
const SECRET = "host-secret-value";
const pass = (_req: Request, _res: Response, next: NextFunction) => next();

vi.mock("../../../database/db/index.js", () => ({
  getDb: () => state.ctx!.drizzle,
  getSqlite: () => null,
}));
vi.mock("../../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    triggerSave: vi.fn(),
    forceSave: vi.fn(async () => {}),
    batched: <T>(work: T) => work,
  },
}));
vi.mock("../../../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({
      getEncryptionKey: async () => Buffer.alloc(32, 7),
      getJWTSecret: async () => "secret",
    }),
  },
}));
vi.mock("../../../utils/data-crypto.js", () => ({
  DataCrypto: {
    getUserDataKey: () => Buffer.alloc(32, 3),
    validateUserAccess: () => Buffer.alloc(32, 3),
    encryptRecord: (_table: string, record: unknown) => record,
    decryptRecord: (_table: string, record: unknown) => record,
    decryptRecords: (_table: string, records: unknown) => records,
  },
}));
vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () => (req: Request, _res: Response, next: NextFunction) => {
          (req as Request & { userId: string }).userId = USER;
          next();
        },
      createDataAccessMiddleware: () => pass,
      createAdminMiddleware: () => pass,
    }),
  },
}));
vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      requirePermission: (permission: string) =>
        Object.assign(
          (_req: Request, res: Response, next: NextFunction) => {
            if (state.granted.has(permission)) return next();
            res.status(403).json({ required: permission });
          },
          { permission },
        ),
      canAccessHost: async () => ({ hasAccess: true, isOwner: true }),
      hasPermission: async (_user: string, permission: string) =>
        state.granted.has(permission),
      isAdmin: async () => false,
      getUserPermissions: async () => [...state.granted],
    }),
  },
}));
vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: async () => {},
  getAuditUsername: async () => USER,
  getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

const { TestSqliteDatabase } = await import("../repositories/test-support.js");
const { hosts } = await import("../../../database/db/schema.js");
const { default: hostRouter } =
  await import("../../../database/routes/host.js");

const app = express();
app.use(express.json());
app.use("/host", hostRouter);

let db: InstanceType<typeof TestSqliteDatabase>;
let ctx: DatabaseContext;
let hostId: number;

beforeEach(async () => {
  state.granted = new Set();
  db = new TestSqliteDatabase("sqlite");
  ctx = await db.connect();
  state.ctx = ctx;
  await ctx.drizzle.run(
    sql`INSERT INTO users (id, username, password_hash, is_admin) VALUES (${USER}, ${USER}, '', 0)`,
  );
  const [row] = await ctx.drizzle
    .insert(hosts)
    .values({
      userId: USER,
      name: "box",
      ip: "10.0.0.5",
      port: 22,
      username: "root",
      authType: "password",
      password: SECRET,
    })
    .returning({ id: hosts.id });
  hostId = row.id;
});

afterEach(async () => {
  await db.close();
});

describe("GHSA-wvxx-mj5f-pxgm host secret copy needs hosts.view", () => {
  it("refuses the password route without hosts.view", async () => {
    state.granted = new Set([
      "hosts.create",
      "hosts.edit",
      "hosts.delete",
      "hosts.share",
    ]);
    const res = await request(app).get(`/host/db/host/${hostId}/password`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it("returns the password with hosts.view", async () => {
    state.granted = new Set(["hosts.view"]);
    const res = await request(app).get(`/host/db/host/${hostId}/password`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ value: SECRET });
  });

  it("checks hosts.view on every host read route", () => {
    // Editor helpers and admin settings use their own checks.
    const exempt = new Set([
      "/device-auth/folder/:protocol",
      "/policy",
      "/tags",
      "/status/settings",
      "/defaults/admin",
      "/defaults/user",
      "/defaults/folders/:folderId",
      "/defaults/resolve",
      "/defaults/jobs/:id",
    ]);
    type Layer = {
      route?: {
        path: string | string[];
        methods: Record<string, boolean>;
        stack: { handle: { permission?: string } }[];
      };
    };
    const reads = (hostRouter.stack as Layer[])
      .map((layer) => layer.route)
      .filter((route) => !!route?.methods.get)
      .filter((route) => !exempt.has(String(route!.path)));

    expect(reads.length).toBeGreaterThan(5);
    const missing = reads
      .filter(
        (route) =>
          !route!.stack.some(
            (entry) => entry.handle.permission === "hosts.view",
          ),
      )
      .map((route) => String(route!.path));
    expect(missing).toEqual([]);
  });
});
