/**
 * The create and update host routes against a real SQLite database. A body
 * that leaves out authType must never reach the NOT NULL auth_type column.
 */

import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseContext } from "../../../database/repositories/database-context.js";

const state = vi.hoisted(() => ({
  ctx: null as null | { drizzle: unknown },
}));

const USER = "user-1";
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
      requirePermission: () => pass,
      canAccessHost: async () => ({ hasAccess: true, isOwner: true }),
      hasPermission: async () => true,
      isAdmin: async () => true,
      getUserPermissions: async () => [],
    }),
  },
}));
vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: async () => {},
  getAuditUsername: async () => USER,
  getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

const { TestSqliteDatabase } = await import("../repositories/test-support.js");
const { hosts, sshCredentials } =
  await import("../../../database/db/schema.js");
const { saveLevel } = await import("../../../hosts/defaults/service.js");
const { default: hostRouter } =
  await import("../../../database/routes/host.js");
const { pluginEvents, TOPICS } = await import("../../../plugins/events.js");

const app = express();
app.use(express.json());
app.use("/host", hostRouter);

let db: InstanceType<typeof TestSqliteDatabase>;
let ctx: DatabaseContext;

beforeEach(async () => {
  db = new TestSqliteDatabase("sqlite");
  ctx = await db.connect();
  state.ctx = ctx;
  await ctx.drizzle.run(
    sql`INSERT INTO users (id, username, password_hash, is_admin) VALUES (${USER}, ${USER}, '', 1)`,
  );
});

afterEach(async () => {
  await db.close();
});

async function addCredential(): Promise<number> {
  const [row] = await ctx.drizzle
    .insert(sshCredentials)
    .values({
      userId: USER,
      name: "ops",
      username: "root",
      authType: "password",
      password: "secret",
    })
    .returning({ id: sshCredentials.id });
  return row.id;
}

async function storedAuthType(id: number) {
  const [row] = await ctx.drizzle
    .select({ authType: hosts.authType })
    .from(hosts)
    .where(eq(hosts.id, id));
  return row?.authType;
}

const base = { ip: "10.0.0.5", port: 22, username: "root" };

describe("host create without authType", () => {
  it("infers credential auth from a credentialId", async () => {
    const credentialId = await addCredential();
    const res = await request(app)
      .post("/host/db/host")
      .send({ ...base, credentialId });
    expect(res.status).toBe(200);
    expect(await storedAuthType(res.body.id)).toBe("credential");
  });

  it("infers password auth from a password", async () => {
    const res = await request(app)
      .post("/host/db/host")
      .send({ ...base, password: "pw" });
    expect(res.status).toBe(200);
    expect(await storedAuthType(res.body.id)).toBe("password");
  });

  it("rejects a body that says nothing about authentication", async () => {
    const res = await request(app).post("/host/db/host").send(base);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/authType is required/);
  });

  it("takes the auth type from the user's host defaults", async () => {
    const credentialId = await addCredential();
    await saveLevel(
      { level: "user", userId: USER },
      {
        set: new Map([["core.auth", { authType: "credential", credentialId }]]),
        unset: new Set(),
        errors: {},
      },
      USER,
    );
    const res = await request(app).post("/host/db/host").send(base);
    expect(res.status).toBe(200);
    expect(await storedAuthType(res.body.id)).toBe("credential");
  });
});

describe("host update authType", () => {
  it("keeps the stored auth type when the update leaves it out", async () => {
    const created = await request(app)
      .post("/host/db/host")
      .send({ ...base, authType: "password", password: "pw" });
    const res = await request(app)
      .put(`/host/db/host/${created.body.id}`)
      .send({ ...base, name: "renamed" });
    expect(res.status).toBe(200);
    expect(await storedAuthType(created.body.id)).toBe("password");
  });

  it("rejects an authType that is not a string", async () => {
    const created = await request(app)
      .post("/host/db/host")
      .send({ ...base, authType: "password", password: "pw" });
    const res = await request(app)
      .put(`/host/db/host/${created.body.id}`)
      .send({ ...base, authType: { bad: true } });
    expect(res.status).toBe(400);
  });
});

describe("host.created", () => {
  it("is published once when a host is created, and not on update", async () => {
    const seen: unknown[] = [];
    const off = pluginEvents.on(TOPICS.hostCreated, (payload) => {
      seen.push(payload);
    });
    try {
      const created = await request(app)
        .post("/host/db/host")
        .send({ ...base, authType: "password", password: "pw" });
      expect(created.status).toBe(200);
      await request(app)
        .put(`/host/db/host/${created.body.id}`)
        .send({ ...base, name: "renamed" });
      expect(seen).toEqual([{ hostId: created.body.id, userId: USER }]);
    } finally {
      off();
    }
  });
});
