/**
 * A credential shared at use level lets the recipient connect with it, never
 * read it. Run against a real SQLite database; only the snapshot decryption
 * is faked.
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
}));

const OWNER = "owner-1";
const USER = "user-1";
const SECRET = "owner-secret-value";
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
vi.mock(
  "../../../utils/shared-credential-secrets-manager.js",
  async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    SharedCredentialSecretsManager: {
      getInstance: () => ({
        getSecretForUser: async () => ({
          username: "root",
          authType: "password",
          password: SECRET,
          privateKey: null,
          keyPassword: null,
        }),
        snapshotForUser: async () => {},
      }),
    },
  }),
);
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
      isAdmin: async () => false,
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
const { hosts, sshCredentials, credentialAccess } =
  await import("../../../database/db/schema.js");
const { default: hostRouter } =
  await import("../../../database/routes/host.js");

const app = express();
app.use(express.json());
app.use("/host", hostRouter);

let db: InstanceType<typeof TestSqliteDatabase>;
let ctx: DatabaseContext;
let credentialId: number;

beforeEach(async () => {
  db = new TestSqliteDatabase("sqlite");
  ctx = await db.connect();
  state.ctx = ctx;
  for (const id of [OWNER, USER]) {
    await ctx.drizzle.run(
      sql`INSERT INTO users (id, username, password_hash, is_admin) VALUES (${id}, ${id}, '', 0)`,
    );
  }
  const [row] = await ctx.drizzle
    .insert(sshCredentials)
    .values({
      userId: OWNER,
      name: "ops",
      username: "root",
      authType: "password",
      password: SECRET,
    })
    .returning({ id: sshCredentials.id });
  credentialId = row.id;
});

afterEach(async () => {
  await db.close();
});

async function share(level: "use" | "manage") {
  await ctx.drizzle.insert(credentialAccess).values({
    credentialId,
    userId: USER,
    grantedBy: OWNER,
    permissionLevel: level,
  });
}

async function ownHostWithCredential(): Promise<number> {
  const [row] = await ctx.drizzle
    .insert(hosts)
    .values({
      userId: USER,
      name: "web",
      ip: "10.0.0.5",
      port: 22,
      username: "root",
      authType: "credential",
      credentialId,
    })
    .returning({ id: hosts.id });
  return row.id;
}

const quick = () => ({
  ip: "192.0.2.10",
  port: 22,
  username: "x",
  authType: "credential",
  credentialId,
});

describe("GHSA-w53f-cpmg-pxvx quick connect", () => {
  it("never returns a use level credential's secret", async () => {
    await share("use");
    const res = await request(app).post("/host/quick-connect").send(quick());
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(res.body.authType).toBe("credential");
    expect(res.body.credentialId).toBe(credentialId);
  });

  it("still answers 404 for a credential that is not shared", async () => {
    const res = await request(app).post("/host/quick-connect").send(quick());
    expect(res.status).toBe(404);
  });

  it("returns the secret to a manage level recipient", async () => {
    await share("manage");
    const res = await request(app).post("/host/quick-connect").send(quick());
    expect(res.status).toBe(200);
    expect(res.body.password).toBe(SECRET);
  });
});

describe("GHSA-w53f-cpmg-pxvx host password copy", () => {
  it("does not reveal a use level credential through the user's own host", async () => {
    await share("use");
    const hostId = await ownHostWithCredential();
    const res = await request(app).get(`/host/db/host/${hostId}/password`);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(res.status).toBe(404);
  });

  it("reveals it with a manage grant", async () => {
    await share("manage");
    const hostId = await ownHostWithCredential();
    const res = await request(app).get(`/host/db/host/${hostId}/password`);
    expect(res.status).toBe(200);
    expect(res.body.value).toBe(SECRET);
  });
});
