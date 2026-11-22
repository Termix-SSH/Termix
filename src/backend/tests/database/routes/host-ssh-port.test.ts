/**
 * Hosts that store two SSH ports, through the real routes, importers and
 * ctx.hosts against SQLite. Such a host dials `port`; `ssh_port` still holds
 * the column default of 22 from before 2.3. Nothing but an explicit change or
 * reset may move it off the port it dials.
 */

import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import Database from "better-sqlite3";
import ts from "typescript";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseContext } from "../../../database/repositories/database-context.js";

const state = vi.hoisted(() => ({
  ctx: null as null | { drizzle: unknown },
  links: [] as unknown[],
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
  splitSecrets: (_table: string, record: Record<string, unknown>) => ({
    plain: record,
    secrets: {},
  }),
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
vi.mock("../../../sync/client/link-store.js", () => ({
  listLinks: async () => state.links,
  getLink: async () => state.links[0] ?? null,
}));
vi.mock("../../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({ resyncHost: async () => {} }),
  },
}));
vi.mock("../../../plugins/actor.js", () => ({ getActor: () => USER }));
vi.mock("../../../plugins/permissions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../plugins/permissions.js")>()),
  assertCapability: async () => {},
}));

const { TestSqliteDatabase } = await import("../repositories/test-support.js");
const { hosts } = await import("../../../database/db/schema.js");
const { default: hostRouter } =
  await import("../../../database/routes/host.js");
const { applyHostDefaultsToWrite, applyDefaultsAfterHostWrites } =
  await import("../../../hosts/defaults/index.js");
const {
  createCurrentCredentialRepository,
  createCurrentHostDefaultsRepository,
  createCurrentHostRepository,
  createCurrentUserRepository,
} = await import("../../../database/repositories/factory.js");
const { sshOptionsForWrite } = await import("../../../hosts/ssh-options.js");
const { createPluginHosts } = await import("../../../plugins/ctx-hosts.js");
const { repairSshPorts, runSshPortRepairMigration } =
  await import("../../../upgrade/ssh-port-repair-migration.js");
const { reconcileUser } = await import("../../../sync/server/feed.js");
const { applyPush } = await import("../../../sync/server/push.js");
const { getRecord } = await import("../../../sync/records.js");

const app = express();
app.use(express.json());
app.use("/host", hostRouter);

let db: InstanceType<typeof TestSqliteDatabase>;
let ctx: DatabaseContext;

beforeEach(async () => {
  db = new TestSqliteDatabase("sqlite");
  ctx = await db.connect();
  state.ctx = ctx;
  state.links = [];
  await ctx.drizzle.run(
    sql`INSERT INTO users (id, username, password_hash, is_admin) VALUES (${USER}, ${USER}, '', 1)`,
  );
});

afterEach(async () => {
  await db.close();
});

/** A host as 2.9 left one from before 2.3: classified, inheriting 22. */
async function legacyHost(
  port = 2222,
  overrides: string | null = '{"core":[]}',
): Promise<number> {
  await ctx.drizzle.run(
    sql`INSERT INTO ssh_data (user_id, name, ip, port, ssh_port, username, auth_type, password, default_overrides)
        VALUES (${USER}, 'legacy', '10.0.0.5', ${port}, 22, 'root', 'password', 'pw', ${overrides})`,
  );
  const [row] = await ctx.drizzle
    .select({ id: hosts.id })
    .from(hosts)
    .where(eq(hosts.port, port));
  return row.id;
}

async function stored(id: number) {
  const [row] = await ctx.drizzle
    .select({
      port: hosts.port,
      sshPort: hosts.sshPort,
      defaultOverrides: hosts.defaultOverrides,
    })
    .from(hosts)
    .where(eq(hosts.id, id));
  return {
    port: row.port,
    sshPort: row.sshPort,
    ownsPort: (JSON.parse(row.defaultOverrides ?? "{}").core ?? []).includes(
      "sshPort",
    ),
  };
}

async function byIp(ip: string) {
  const [row] = await ctx.drizzle
    .select({ id: hosts.id })
    .from(hosts)
    .where(eq(hosts.ip, ip));
  return stored(row.id);
}

/**
 * The /database/import handler, run with the real repositories and host
 * defaults. database.ts starts the whole server on import, so its handler is
 * lifted out as import-route.test.ts does.
 */
function databaseImportRoute() {
  const source = fs.readFileSync(
    new URL("../../../database/database.ts", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "database.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const route = ast.statements.find(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isCallExpression(statement.expression) &&
      statement.expression.arguments[0]?.getText(ast) === '"/database/import"',
  ) as ts.ExpressionStatement;
  const batched = (route.expression as ts.CallExpression)
    .arguments[3] as ts.CallExpression;
  const quiet = {
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
  };
  return runInNewContext(
    ts.transpileModule(`(${batched.arguments[0].getText(ast)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      fs,
      Buffer,
      Database,
      parseUserAgent: () => ({ type: "web" }),
      createCurrentUserRepository,
      createCurrentCredentialRepository,
      createCurrentHostRepository,
      DataCrypto: { getUserDataKey: () => Buffer.alloc(32, 3) },
      apiLogger: quiet,
      legacyStatusCheck: () => ({}),
      sshOptionsForWrite,
      applyHostDefaultsToWrite,
      applyDefaultsAfterHostWrites,
      applyPluginHostImportSettings: async () => {},
      importedHostPluginSettings: () => ({}),
      importHostProtocolLogins: async () => {},
      importUserPluginRows: async () => ({
        imported: 0,
        skipped: 0,
        errors: [],
      }),
      importHostDefaults: async () => ({ imported: 0, skipped: 0 }),
      readImportedSettings: () => [],
      upsertImportedSetting: async () => {},
      recompute: async () => {},
      DatabaseSaveTrigger: { forceSave: async () => {} },
      getErrorMessage: (error: Error) => error.message,
      pluginEvents: { emit: () => {} },
      TOPICS: { hostCreated: "host.created" },
    },
  );
}

const pluginHosts = () =>
  createPluginHosts({
    manifest: {
      id: "port-test",
      capabilities: ["hosts:read", "hosts:write"],
    } as never,
    audit: async () => {},
  });

describe("host routes", () => {
  it("returns the port the host dials", async () => {
    const id = await legacyHost();
    const res = await request(app).get(`/host/db/host/${id}`);
    expect(res.status).toBe(200);
    expect([res.body.port, res.body.sshPort]).toEqual([2222, 2222]);
  });

  it("keeps the port when the unchanged GET body is saved", async () => {
    const id = await legacyHost();
    const { body } = await request(app).get(`/host/db/host/${id}`);
    const res = await request(app)
      .put(`/host/db/host/${id}`)
      .send({ ...body, password: "pw" });
    expect(res.status).toBe(200);
    expect(await stored(id)).toEqual({
      port: 2222,
      sshPort: 2222,
      ownsPort: true,
    });
  });

  it("keeps the port when the editor saves its one port field", async () => {
    const id = await legacyHost();
    const { body } = await request(app).get(`/host/db/host/${id}`);
    // The layouts' editors read sshPort and send it as both columns, with
    // the override list they were given.
    const res = await request(app).put(`/host/db/host/${id}`).send({
      name: body.name,
      ip: body.ip,
      username: body.username,
      authType: "password",
      password: "pw",
      connectionType: "ssh",
      port: body.sshPort,
      sshPort: body.sshPort,
      defaultOverrides: body.defaultOverrides,
    });
    expect(res.status).toBe(200);
    expect((await stored(id)).port).toBe(2222);
  });

  it("stores a created host's port in both columns", async () => {
    const res = await request(app).post("/host/db/host").send({
      ip: "10.0.0.6",
      port: 2224,
      username: "root",
      authType: "password",
      password: "pw",
    });
    expect(res.status).toBe(200);
    expect(await stored(res.body.id)).toMatchObject({
      port: 2224,
      sshPort: 2224,
    });
  });

  it("keeps the port through a new SSH port default", async () => {
    const id = await legacyHost();
    const res = await request(app)
      .put("/host/defaults/user")
      .send({ set: { "core.sshPort": 2300 } });
    expect(res.status).toBe(200);
    expect(await stored(id)).toMatchObject({ port: 2222, ownsPort: true });
  });

  it("moves the port only when it is reset to its default", async () => {
    const id = await legacyHost(2222, '{"core":["sshPort"]}');
    await request(app)
      .post(`/host/db/host/${id}/reset-defaults`)
      .send({ keys: ["core.username"] });
    expect((await stored(id)).port).toBe(2222);

    const res = await request(app)
      .post(`/host/db/host/${id}/reset-defaults`)
      .send({ keys: ["core.sshPort"] });
    expect(res.status).toBe(200);
    expect(await stored(id)).toEqual({
      port: 22,
      sshPort: 22,
      ownsPort: false,
    });
  });
});

describe("imports", () => {
  it("stores an imported host's port in both columns", async () => {
    await pluginHosts().importMany([
      {
        name: "json",
        ip: "10.0.0.7",
        port: 2240,
        username: "root",
        authType: "password",
        password: "pw",
      },
    ] as never);
    await pluginHosts().importSshConfig(
      "Host cfg\n  HostName 10.0.0.8\n  Port 2250\n  User root\n",
    );
    expect(await byIp("10.0.0.7")).toMatchObject({
      port: 2240,
      sshPort: 2240,
    });
    expect(await byIp("10.0.0.8")).toMatchObject({
      port: 2250,
      sshPort: 2250,
    });
  });

  it("keeps the port when its own export is imported over it", async () => {
    const id = await legacyHost();
    const exported = await pluginHosts().exportMany();
    await pluginHosts().importMany(
      exported.hosts.map((host) => ({ ...host, notes: "imported" })) as never,
      { overwrite: true },
    );
    expect(await stored(id)).toEqual({
      port: 2222,
      sshPort: 2222,
      ownsPort: true,
    });

    await pluginHosts().importSshConfig(
      "Host cfg\n  HostName 10.0.0.5\n  Port 2222\n  User root\n",
      { overwrite: true },
    );
    expect((await stored(id)).port).toBe(2222);
  });

  it("stores the port of a database import in both columns", async () => {
    // The ssh_data columns /database/export writes: port, never ssh_port.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-ssh-port-"));
    const file = path.join(dir, "export.db");
    const exportDb = new Database(file);
    exportDb.exec(`
      CREATE TABLE ssh_data (id INTEGER, connection_type TEXT, name TEXT, ip TEXT, port INTEGER, username TEXT, auth_type TEXT, password TEXT);
      INSERT INTO ssh_data VALUES (1, 'ssh', 'restored', '10.0.0.9', 2223, 'root', 'password', 'pw');
    `);
    exportDb.close();
    try {
      const res = { json: vi.fn(), status: vi.fn() };
      res.status.mockReturnValue(res);
      await databaseImportRoute()(
        { userId: USER, file: { path: file, originalname: "export.db" } },
        res,
      );
      expect(res.status).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(await byIp("10.0.0.9")).toMatchObject({
      port: 2223,
      sshPort: 2223,
    });
  });
});

describe("ctx.hosts", () => {
  it("keeps the port when a plugin updates only the notes", async () => {
    const id = await legacyHost();
    await pluginHosts().update(id, { notes: "rotated" });
    expect(await stored(id)).toEqual({
      port: 2222,
      sshPort: 2222,
      ownsPort: true,
    });
  });

  it("applies a plugin's port change, and keeps it through a default", async () => {
    const id = await legacyHost();
    await pluginHosts().update(id, { port: 2240 });
    await request(app)
      .put("/host/defaults/user")
      .send({ set: { "core.sshPort": 2300 } });
    expect(await stored(id)).toEqual({
      port: 2240,
      sshPort: 2240,
      ownsPort: true,
    });
  });
});

describe("sync on a server", () => {
  /** The one host's wire row, and the revision a desktop holds for it. */
  async function synced() {
    const { wire } = await reconcileUser(USER, { force: true });
    const [row] = [...wire]
      .filter(([key]) => key.startsWith("hosts\0"))
      .map(([, value]) => value);
    const syncId = String(row.syncId);
    const record = await getRecord(USER, "hosts", syncId);
    return { row, syncId, revision: record!.revision };
  }

  const push = (syncId: string, revision: number, row: object) =>
    applyPush(USER, [
      {
        entityType: "hosts",
        syncId,
        baseRevision: revision,
        op: "upsert",
        row,
      },
    ]);

  it("keeps the port of an accepted push that still holds two ports", async () => {
    const id = await legacyHost(2222, '{"core":["sshPort"]}');
    const { row, syncId, revision } = await synced();
    // A desktop without the fix pushes its copy, with no claim on the port.
    const [result] = await push(syncId, revision, {
      ...row,
      notes: "pushed",
      defaultOverrides: '{"core":[]}',
    });
    expect(result.status).toBe("ok");
    await request(app)
      .put("/host/defaults/user")
      .send({ set: { "core.sshPort": 2300 } });
    // The stated limit: ssh_port stays as pushed until the next write.
    expect(await stored(id)).toEqual({
      port: 2222,
      sshPort: 22,
      ownsPort: true,
    });
  });

  it("sends the repaired row back to a push made before the repair", async () => {
    const id = await legacyHost();
    const before = await synced();
    await repairSshPorts(createCurrentHostDefaultsRepository());

    const [result] = await push(before.syncId, before.revision, {
      ...before.row,
      notes: "stale",
    });
    expect(result).toMatchObject({ status: "conflict" });
    const conflict = result as {
      revision: number;
      row: Record<string, unknown>;
    };
    expect(conflict.revision).toBe(before.revision + 1);
    expect([conflict.row.port, conflict.row.sshPort]).toEqual([2222, 2222]);
    expect(await stored(id)).toEqual({
      port: 2222,
      sshPort: 2222,
      ownsPort: true,
    });
  });
});

describe("a linked desktop", () => {
  it("skips the repair, and a local edit only makes the port own", async () => {
    state.links = [{ id: "link" }];
    const id = await legacyHost();
    await runSshPortRepairMigration();
    expect(await stored(id)).toEqual({
      port: 2222,
      sshPort: 22,
      ownsPort: false,
    });

    await pluginHosts().update(id, { notes: "local" });
    expect(await stored(id)).toEqual({
      port: 2222,
      sshPort: 2222,
      ownsPort: true,
    });
  });
});
