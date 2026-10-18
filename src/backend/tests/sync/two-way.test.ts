/**
 * A server and linked desktops, each with its own database, syncing through
 * the real engine and the real /sync/v2 routes. Only the network, auth and
 * the crypto keys are faked.
 */

import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseContext } from "../../database/repositories/database-context.js";

const state = vi.hoisted(() => ({
  current: null as null | { drizzle: unknown },
  server: null as null | { drizzle: unknown },
  allow: true,
  sharedHostIds: new Set<number>(),
  paths: [] as string[],
}));

const SERVER_USER = "srv-user";

vi.mock("../../database/db/index.js", () => ({
  getDb: () => state.current!.drizzle,
  getSqlite: () => null,
}));
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    triggerSave: vi.fn(),
    forceSave: vi.fn(async () => {}),
    batched: <T>(work: T) => work,
  },
}));
vi.mock("../../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({
      getEncryptionKey: async () => Buffer.alloc(32, 7),
      getJWTSecret: async () => "secret",
    }),
  },
}));
vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: {
    getUserDataKey: () => Buffer.alloc(32, 3),
    decryptRecord: (_table: string, record: unknown) => record,
  },
}));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      hasPermission: async () => state.allow,
      canAccessHost: async (_userId: string, hostId: number) => ({
        hasAccess: state.sharedHostIds.has(hostId),
      }),
      getUserPermissions: async () => [],
    }),
  },
}));
vi.mock("../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({
      resyncHost: async () => {},
      resyncHostsForCredential: async () => {},
    }),
  },
}));
vi.mock("../../utils/shared-credential-secrets-manager.js", () => ({
  SharedCredentialSecretsManager: {
    getInstance: () => ({ resyncCredential: async () => {} }),
  },
}));
vi.mock("../../hosts/delete-host.js", async () => {
  const { hosts } = await import("../../database/db/schema.js");
  const { eq: equals } = await import("drizzle-orm");
  return {
    deleteOwnedHost: async (_userId: string, id: number) => {
      await (state.current!.drizzle as DatabaseContext["drizzle"])
        .delete(hosts)
        .where(equals(hosts.id, id));
      return { id, name: "" };
    },
  };
});
vi.mock("../../hosts/delete-credential.js", async () => {
  const { sshCredentials } = await import("../../database/db/schema.js");
  const { eq: equals } = await import("drizzle-orm");
  return {
    deleteOwnedCredential: async (_userId: string, id: number) => {
      await (state.current!.drizzle as DatabaseContext["drizzle"])
        .delete(sshCredentials)
        .where(equals(sshCredentials.id, id));
      return { name: null };
    },
  };
});
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () => (req: { userId?: string }, _res: unknown, next: () => void) => {
          req.userId = SERVER_USER;
          next();
        },
      generateJWTToken: async () => "desktop-session",
      revokeSession: async () => true,
    }),
  },
}));
vi.mock("../../notify/core-notify.js", () => ({ sendCoreAlert: vi.fn() }));
vi.mock("../../sync/client/plugins.js", () => ({
  mirrorPlugins: async () => {},
  lastRemotePlugins: () => [],
  isServerManaged: () => false,
}));
vi.mock("../../sync/client/http.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../sync/client/http.js")>();
  return {
    ...actual,
    // The event stream is not under test.
    remoteFetch: () => new Promise(() => {}),
    remoteJson: async (
      _target: unknown,
      path: string,
      init: { method?: string; body?: unknown } = {},
    ) => {
      state.paths.push(path);
      const previous = state.current;
      state.current = state.server;
      try {
        const agent = request(app);
        const method = (init.method ?? "GET").toLowerCase() as "get" | "post";
        const response = await agent[method](path).send(
          init.body as object | undefined,
        );
        if (response.status >= 400) {
          throw new actual.RemoteError(
            "server",
            response.body?.error ?? "error",
            response.status,
          );
        }
        return response.body;
      } finally {
        state.current = previous;
      }
    },
  };
});

const { TestSqliteDatabase } =
  await import("../database/repositories/test-support.js");
const schema = await import("../../database/db/schema.js");
const { default: syncRouter } = await import("../../sync/server/routes.js");
const { SyncEngine } = await import("../../sync/client/engine.js");
const { createLink, getLink, updateLink } =
  await import("../../sync/client/link-store.js");
const { markChanged, reconcileUser, resetFeed } =
  await import("../../sync/server/feed.js");
const { resetSeqAllocator, listConflicts, getConflict, deleteConflict } =
  await import("../../sync/records.js");
const { createResolvers, writeWireRow } = await import("../../sync/store.js");
const { getEntity } = await import("../../plugins/sync-registry.js");
const { FieldCrypto } = await import("../../utils/field-crypto.js");
const { syncLogger } = await import("../../utils/logger.js");
const { pluginEvents, TOPICS } = await import("../../plugins/events.js");

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use("/sync", syncRouter);

type Db = InstanceType<typeof TestSqliteDatabase>;
interface Side {
  db: Db;
  ctx: DatabaseContext;
  userId: string;
}

let server: Side;
let desktops: Side[] = [];

async function side(userId: string): Promise<Side> {
  const db = new TestSqliteDatabase("sqlite");
  const ctx = await db.connect();
  await db.run(
    sql`INSERT INTO users (id, username, password_hash, is_admin) VALUES (${userId}, ${userId}, '', 1)`,
  );
  return { db, ctx, userId };
}

async function on<T>(where: Side, fn: () => Promise<T>): Promise<T> {
  const previous = state.current;
  state.current = where.ctx;
  try {
    return await fn();
  } finally {
    state.current = previous;
  }
}

function db(where: Side) {
  return where.ctx.drizzle;
}

async function addHost(
  where: Side,
  values: Partial<typeof schema.hosts.$inferInsert> & { name: string },
) {
  await db(where)
    .insert(schema.hosts)
    .values({
      userId: where.userId,
      ip: "10.0.0.1",
      port: 22,
      username: "root",
      authType: "password",
      syncId: `host-${values.name}`,
      ...values,
    });
  // Stands in for the change watcher a write request would trip.
  if (where === server) markChanged();
}

async function hostsOf(where: Side) {
  return db(where)
    .select()
    .from(schema.hosts)
    .where(eq(schema.hosts.userId, where.userId));
}

async function linkDesktop(
  desktop: Side,
): Promise<InstanceType<typeof SyncEngine>> {
  await on(desktop, () =>
    createLink({
      userId: desktop.userId,
      serverUrl: "https://termix.example",
      sessionToken: "desktop-session",
    }),
  );
  return new SyncEngine();
}

async function pass(desktop: Side, engine: InstanceType<typeof SyncEngine>) {
  await on(desktop, () => engine.syncNow());
  const link = await on(desktop, () => getLink());
  expect(link?.lastError ?? null).toBeNull();
}

beforeEach(async () => {
  resetFeed();
  resetSeqAllocator();
  state.allow = true;
  state.sharedHostIds.clear();
  state.paths = [];
  server = await side(SERVER_USER);
  state.server = server.ctx;
  desktops = [await side("desk-a"), await side("desk-b")];
});

afterEach(async () => {
  for (const s of [server, ...desktops]) await s.db.close();
});

describe("linking a desktop", () => {
  it("merges both sides, translating references and keeping secrets", async () => {
    const [desk] = desktops;
    await on(desk, async () => {
      await db(desk).insert(schema.sshCredentials).values({
        userId: desk.userId,
        name: "deploy key",
        authType: "password",
        username: "deploy",
        syncId: "cred-1",
      });
      const [cred] = await db(desk).select().from(schema.sshCredentials);
      await writeWireRow(
        getEntity("hosts")!,
        desk.userId,
        {
          syncId: "host-desk",
          name: "desk",
          ip: "10.0.0.2",
          port: 22,
          username: "root",
          authType: "credential",
          password: "s3cret",
          credentialSyncId: cred.syncId,
        },
        createResolvers(desk.userId),
      );
    });
    await on(server, () => addHost(server, { name: "srv" }));

    const engine = await linkDesktop(desk);
    await pass(desk, engine);

    const serverHosts = await on(server, () => hostsOf(server));
    expect(serverHosts.map((h) => h.name).sort()).toEqual(["desk", "srv"]);
    const pushed = serverHosts.find((h) => h.name === "desk")!;
    const [serverCred] = await db(server).select().from(schema.sshCredentials);
    expect(serverCred.syncId).toBe("cred-1");
    expect(pushed.credentialId).toBe(serverCred.id);
    // Stored encrypted, never as plaintext.
    expect(pushed.password).not.toBe("s3cret");
    expect(pushed.password).toContain('"iv"');

    const deskHosts = await on(desk, () => hostsOf(desk));
    expect(deskHosts.map((h) => h.name).sort()).toEqual(["desk", "srv"]);
  });

  it("adopts the server's version of rows both sides already have", async () => {
    const [desk] = desktops;
    await on(desk, () => addHost(desk, { name: "same", ip: "old" }));
    await on(server, () => addHost(server, { name: "same", ip: "new" }));

    const engine = await linkDesktop(desk);
    await pass(desk, engine);

    const [host] = await on(desk, () => hostsOf(desk));
    expect(host.ip).toBe("new");
    expect(await on(desk, () => listConflicts(desk.userId))).toEqual([]);
  });

  it("never asks for a cursor past what the server's seq column holds", async () => {
    const [desk] = desktops;
    await on(server, () => addHost(server, { name: "srv" }));

    const engine = await linkDesktop(desk);
    await pass(desk, engine);

    const cursors = state.paths
      .filter((path) => path.startsWith("/sync/v2/changes?"))
      .map((path) =>
        Number(new URLSearchParams(path.split("?")[1]).get("cursor")),
      );
    expect(cursors.length).toBeGreaterThan(0);
    expect(Math.max(...cursors)).toBeLessThanOrEqual(2_147_483_647);
  });
});

describe("a synced host", () => {
  it("publishes host.created when it is written for the first time only", async () => {
    const [desk] = desktops;
    const seen: unknown[] = [];
    const off = pluginEvents.on(TOPICS.hostCreated, (payload) => {
      seen.push(payload);
    });
    const wire = {
      syncId: "host-new",
      name: "new",
      ip: "10.0.0.2",
      port: 22,
      username: "root",
      authType: "password",
    };
    try {
      await on(desk, async () => {
        const resolvers = createResolvers(desk.userId);
        const first = await writeWireRow(
          getEntity("hosts")!,
          desk.userId,
          wire,
          resolvers,
        );
        await writeWireRow(
          getEntity("hosts")!,
          desk.userId,
          { ...wire, name: "renamed" },
          resolvers,
        );
        expect(seen).toEqual([{ hostId: first.id, userId: desk.userId }]);
      });
    } finally {
      off();
    }
  });
});

describe("after linking", () => {
  it("sends edits and deletes both ways", async () => {
    const [desk] = desktops;
    await on(server, () => addHost(server, { name: "a" }));
    await on(server, () => addHost(server, { name: "b" }));
    const engine = await linkDesktop(desk);
    await pass(desk, engine);

    await on(desk, async () => {
      await db(desk)
        .update(schema.hosts)
        .set({ ip: "10.9.9.9" })
        .where(eq(schema.hosts.syncId, "host-a"));
    });
    await on(server, async () => {
      await db(server)
        .delete(schema.hosts)
        .where(eq(schema.hosts.syncId, "host-b"));
      markChanged();
    });
    await pass(desk, engine);

    const serverHosts = await on(server, () => hostsOf(server));
    expect(serverHosts.map((h) => [h.name, h.ip])).toEqual([["a", "10.9.9.9"]]);
    const deskHosts = await on(desk, () => hostsOf(desk));
    expect(deskHosts.map((h) => h.name)).toEqual(["a"]);

    await on(desk, async () => {
      await db(desk)
        .delete(schema.hosts)
        .where(eq(schema.hosts.syncId, "host-a"));
    });
    await pass(desk, engine);
    expect(await on(server, () => hostsOf(server))).toEqual([]);
  });

  it("never sends a host kept on this device only", async () => {
    const [desk] = desktops;
    const engine = await linkDesktop(desk);
    await pass(desk, engine);
    await on(desk, () => addHost(desk, { name: "mine", localOnly: true }));
    await pass(desk, engine);

    expect(await on(server, () => hostsOf(server))).toEqual([]);
    expect((await on(desk, () => hostsOf(desk))).map((h) => h.name)).toEqual([
      "mine",
    ]);
  });

  it("keeps a local edit that lost to a newer server edit, and can restore it", async () => {
    const [desk] = desktops;
    await on(server, () => addHost(server, { name: "a" }));
    const engine = await linkDesktop(desk);
    await pass(desk, engine);

    await on(desk, () =>
      db(desk)
        .update(schema.hosts)
        .set({ ip: "desk-edit" })
        .where(eq(schema.hosts.syncId, "host-a")),
    );
    await on(server, async () => {
      await db(server)
        .update(schema.hosts)
        .set({ ip: "server-edit" })
        .where(eq(schema.hosts.syncId, "host-a"));
      markChanged();
    });
    await pass(desk, engine);

    const [local] = await on(desk, () => hostsOf(desk));
    expect(local.ip).toBe("server-edit");
    const conflicts = await on(desk, () => listConflicts(desk.userId));
    expect(conflicts).toHaveLength(1);
    expect(JSON.parse(conflicts[0].localRow).ip).toBe("desk-edit");

    // Keep mine: put it back, and the next pass sends it.
    await on(desk, async () => {
      const conflict = (await getConflict(desk.userId, conflicts[0].id))!;
      await writeWireRow(
        getEntity("hosts")!,
        desk.userId,
        { ...JSON.parse(conflict.localRow), syncId: conflict.syncId },
        createResolvers(desk.userId),
      );
      await deleteConflict(desk.userId, conflict.id);
    });
    await pass(desk, engine);
    const [serverHost] = await on(server, () => hostsOf(server));
    expect(serverHost.ip).toBe("desk-edit");
  });

  it("does not let one refused change hold up the rest", async () => {
    const [desk] = desktops;
    const engine = await linkDesktop(desk);
    await pass(desk, engine);

    await on(desk, async () => {
      await addHost(desk, { name: "one" });
      await db(desk).insert(schema.sshCredentials).values({
        userId: desk.userId,
        name: "cred",
        authType: "password",
        syncId: "cred-x",
      });
    });
    // The server refuses host changes only.
    const hostPermissions = getEntity("hosts")!.permissions;
    const credentialPermissions = getEntity("sshCredentials")!.permissions;
    getEntity("sshCredentials")!.permissions = undefined;
    state.allow = false;
    try {
      await pass(desk, engine);
    } finally {
      getEntity("hosts")!.permissions = hostPermissions;
      getEntity("sshCredentials")!.permissions = credentialPermissions;
    }

    expect(await on(server, () => hostsOf(server))).toEqual([]);
    const creds = await db(server).select().from(schema.sshCredentials);
    expect(creds.map((c) => c.name)).toEqual(["cred"]);
    const [record] = await on(desk, () =>
      db(desk)
        .select()
        .from(schema.syncRecords)
        .where(
          and(
            eq(schema.syncRecords.entityType, "hosts"),
            eq(schema.syncRecords.syncId, "host-one"),
          ),
        ),
    );
    expect(record.error).toBe("permission");
  });

  it("leaves a switched-off kind of data alone, and catches up when it is back on", async () => {
    const [desk] = desktops;
    const engine = await linkDesktop(desk);
    await pass(desk, engine);

    const link = (await on(desk, () => getLink()))!;
    await on(desk, () =>
      updateLink({
        disabledTypes: ["hosts"],
        knownTypes: link.knownTypes.filter((type) => type !== "hosts"),
      }),
    );
    await on(server, () => addHost(server, { name: "later" }));
    await on(desk, () => addHost(desk, { name: "private" }));
    await pass(desk, engine);

    expect((await on(desk, () => hostsOf(desk))).map((h) => h.name)).toEqual([
      "private",
    ]);
    expect(
      (await on(server, () => hostsOf(server))).map((h) => h.name),
    ).toEqual(["later"]);

    await on(desk, () => updateLink({ disabledTypes: [] }));
    await pass(desk, engine);
    await pass(desk, engine);
    const names = (await on(desk, () => hostsOf(desk)))
      .map((h) => h.name)
      .sort();
    expect(names).toEqual(["later", "private"]);
    expect(
      (await on(server, () => hostsOf(server))).map((h) => h.name).sort(),
    ).toEqual(["later", "private"]);
  });
});

describe("a server row that cannot be read", () => {
  async function recordOf(where: Side, syncId: string) {
    const [record] = await on(where, () =>
      db(where)
        .select()
        .from(schema.syncRecords)
        .where(
          and(
            eq(schema.syncRecords.entityType, "hosts"),
            eq(schema.syncRecords.syncId, syncId),
          ),
        ),
    );
    return record;
  }

  it.each(["upsert", "delete"] as const)(
    "retries a local %s after the server row becomes readable",
    async (op) => {
      const [desk] = desktops;
      await on(server, () => addHost(server, { name: "a" }));
      const engine = await linkDesktop(desk);
      await pass(desk, engine);

      await on(desk, () =>
        (op === "delete"
          ? db(desk).delete(schema.hosts)
          : db(desk).update(schema.hosts).set({ ip: "desk-edit" })
        ).where(eq(schema.hosts.syncId, "host-a")),
      );
      await on(server, async () => {
        await db(server)
          .update(schema.hosts)
          .set({ ip: "server-edit" })
          .where(eq(schema.hosts.syncId, "host-a"));
        await reconcileUser(SERVER_USER, { force: true });
        // Then its secret stops decrypting, as under a different key.
        const [host] = await hostsOf(server);
        await db(server)
          .update(schema.hosts)
          .set({
            password: FieldCrypto.encryptField(
              "s3cret",
              Buffer.alloc(32, 9),
              String(host.id),
              "password",
            ),
          })
          .where(eq(schema.hosts.id, host.id));
      });

      const warn = vi.spyOn(syncLogger, "warn");
      try {
        await pass(desk, engine);
        expect(warn).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            entityType: "hosts",
            syncId: "host-a",
            error: expect.any(String),
          }),
        );
      } finally {
        warn.mockRestore();
      }

      const [local] = await on(desk, () => hostsOf(desk));
      expect(local?.ip).toBe(op === "upsert" ? "desk-edit" : undefined);
      expect(await on(desk, () => listConflicts(desk.userId))).toEqual([]);
      expect((await recordOf(desk, "host-a")).error).toBe("unavailable");

      // Restore the same server content without another local edit or a new
      // server revision. The failed operation must still be retried.
      await on(server, () =>
        db(server)
          .update(schema.hosts)
          .set({ password: null })
          .where(eq(schema.hosts.syncId, "host-a")),
      );
      await on(server, () => reconcileUser(SERVER_USER, { force: true }));
      await pass(desk, engine);
      const [after] = await on(desk, () => hostsOf(desk));
      expect(after?.ip).toBe("server-edit");
      expect((await recordOf(desk, "host-a")).error).toBeNull();
      const conflicts = await on(desk, () => listConflicts(desk.userId));
      expect(conflicts.map((c) => JSON.parse(c.localRow).ip)).toEqual(
        op === "upsert" ? ["desk-edit"] : [],
      );
    },
  );

  it("keeps the local row when a conflict carries no row", async () => {
    const [desk] = desktops;
    await on(server, () => addHost(server, { name: "a" }));
    const engine = await linkDesktop(desk);
    await pass(desk, engine);

    await on(desk, async () => {
      const link = (await getLink())!;
      const settle = (
        engine as unknown as {
          settle: (...args: unknown[]) => Promise<void>;
        }
      ).settle.bind(engine);
      await settle(
        link,
        {
          entityType: "hosts",
          syncId: "host-a",
          baseRevision: 1,
          op: "upsert",
          row: { syncId: "host-a", name: "a" },
        },
        {
          entityType: "hosts",
          syncId: "host-a",
          status: "conflict",
          revision: 2,
          deleted: false,
          row: null,
        },
        "hash",
      );
    });

    expect((await on(desk, () => hostsOf(desk))).map((h) => h.name)).toEqual([
      "a",
    ]);
    const record = await recordOf(desk, "host-a");
    expect(record.deleted).toBe(false);
    expect(record.revision).toBe(1);
  });
});

describe("hosts shared with the account", () => {
  it("arrive on the desktop with their text columns as stored", async () => {
    const [desk] = desktops;
    await on(server, async () => {
      await server.db.run(
        sql`INSERT INTO users (id, username, password_hash, is_admin) VALUES ('owner', 'owner', '', 0)`,
      );
      await db(server).insert(schema.hosts).values({
        userId: "owner",
        name: "theirs",
        ip: "10.0.0.5",
        port: 22,
        username: "root",
        authType: "none",
        forceKeyboardInteractive: "true",
        syncId: "host-theirs",
      });
      const [host] = await db(server).select().from(schema.hosts);
      await db(server).insert(schema.hostAccess).values({
        hostId: host.id,
        userId: SERVER_USER,
        grantedBy: "owner",
        permissionLevel: "view",
      });
      state.sharedHostIds.add(host.id);
      markChanged();
    });

    const engine = await linkDesktop(desk);
    await pass(desk, engine);

    const [copy] = await on(desk, () => hostsOf(desk));
    expect(copy?.name).toBe("theirs");
    expect(copy.forceKeyboardInteractive).toBe("true");
    expect(JSON.parse(copy.sharedSource!)).toMatchObject({
      owner: "owner",
      permissionLevel: "view",
    });
  });
});

describe("two desktops on one account", () => {
  it("converge on edits, creates and deletes made offline on each", async () => {
    const [a, b] = desktops;
    await on(server, () => addHost(server, { name: "shared-one" }));
    await on(server, () => addHost(server, { name: "shared-two" }));
    const engineA = await linkDesktop(a);
    const engineB = await linkDesktop(b);
    await pass(a, engineA);
    await pass(b, engineB);

    // Offline on both.
    await on(a, () => addHost(a, { name: "from-a" }));
    await on(a, () =>
      db(a)
        .update(schema.hosts)
        .set({ ip: "10.1.1.1" })
        .where(eq(schema.hosts.syncId, "host-shared-one")),
    );
    await on(b, () =>
      db(b)
        .delete(schema.hosts)
        .where(eq(schema.hosts.syncId, "host-shared-two")),
    );
    await on(b, () => addHost(b, { name: "from-b" }));

    await pass(a, engineA);
    await pass(b, engineB);
    await pass(a, engineA);

    const view = async (where: Side) =>
      (await on(where, () => hostsOf(where)))
        .map((h) => `${h.name}:${h.ip}`)
        .sort();
    const expected = [
      "from-a:10.0.0.1",
      "from-b:10.0.0.1",
      "shared-one:10.1.1.1",
    ];
    expect(await view(server)).toEqual(expected);
    expect(await view(a)).toEqual(expected);
    expect(await view(b)).toEqual(expected);
  });
});
