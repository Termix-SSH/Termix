import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { SessionRepository } from "./session-repository.js";
import { UserRepository } from "./user-repository.js";

describe("UserRepository and SessionRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepositories(): Promise<{
    users: UserRepository;
    sessions: SessionRepository;
  }>;
  async function createRepositories(options: {
    onUserWrite?: () => void | Promise<void>;
    onSessionWrite?: () => void | Promise<void>;
  }): Promise<{
    users: UserRepository;
    sessions: SessionRepository;
  }>;
  async function createRepositories(
    options: {
      onUserWrite?: () => void | Promise<void>;
      onSessionWrite?: () => void | Promise<void>;
    } = {},
  ): Promise<{
    users: UserRepository;
    sessions: SessionRepository;
  }> {
    adapter = new SqliteDatabaseAdapter({
      dialect: "sqlite",
      url: ":memory:",
      sqlitePath: ":memory:",
    });
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_oidc INTEGER NOT NULL DEFAULT 0,
        oidc_identifier TEXT,
        sso_provider_id INTEGER,
        client_id TEXT,
        client_secret TEXT,
        issuer_url TEXT,
        authorization_url TEXT,
        token_url TEXT,
        identifier_path TEXT,
        name_path TEXT,
        scopes TEXT DEFAULT 'openid email profile',
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        totp_backup_codes TEXT
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        jwt_token TEXT NOT NULL,
        device_type TEXT NOT NULL,
        device_info TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    return {
      users: new UserRepository(context, options.onUserWrite),
      sessions: new SessionRepository(context, options.onSessionWrite),
    };
  }

  it("creates, finds, updates, and deletes users", async () => {
    const repo = await createRepositories();

    await repo.users.create({
      id: "user-1",
      username: "admin",
      passwordHash: "hash",
      isAdmin: true,
      isOidc: false,
    });

    expect(await repo.users.countAdmins()).toBe(1);
    expect((await repo.users.listAll()).map((user) => user.id)).toEqual([
      "user-1",
    ]);
    expect((await repo.users.findByUsername("admin"))?.id).toBe("user-1");

    const updated = await repo.users.update("user-1", {
      oidcIdentifier: "oidc:admin",
    });
    expect(updated?.oidcIdentifier).toBe("oidc:admin");
    expect((await repo.users.findByOidcIdentifier("oidc:admin"))?.id).toBe(
      "user-1",
    );

    expect(await repo.users.delete("user-1")).toBe(true);
    expect(await repo.users.findById("user-1")).toBeNull();
  });

  it("creates the first local user as admin inside the repository", async () => {
    const repo = await createRepositories();

    const first = await repo.users.createFirstLocalUser({
      id: "user-1",
      username: "first",
      passwordHash: "hash",
      isOidc: false,
    });
    const second = await repo.users.createFirstLocalUser({
      id: "user-2",
      username: "second",
      passwordHash: "hash",
      isOidc: false,
    });

    expect(first.isFirstUser).toBe(true);
    expect(first.user.isAdmin).toBe(true);
    expect(second.isFirstUser).toBe(false);
    expect(second.user.isAdmin).toBe(false);
    expect(await repo.users.countAll()).toBe(2);
  });

  it("runs the user write hook after user writes", async () => {
    let writeCount = 0;
    const repo = await createRepositories({
      onUserWrite: () => {
        writeCount += 1;
      },
    });

    await repo.users.create({
      id: "user-1",
      username: "admin",
      passwordHash: "hash",
      isAdmin: true,
      isOidc: false,
    });
    await repo.users.update("user-1", { isAdmin: false });
    await repo.users.delete("user-1");

    expect(writeCount).toBe(3);
  });

  it("creates, touches, lists, and revokes sessions", async () => {
    const repo = await createRepositories();
    await repo.users.create({
      id: "user-1",
      username: "user",
      passwordHash: "hash",
      isAdmin: false,
      isOidc: false,
    });

    await repo.sessions.create({
      id: "session-1",
      userId: "user-1",
      jwtToken: "token",
      deviceType: "desktop",
      deviceInfo: "Firefox",
      createdAt: "2026-06-26T00:00:00.000Z",
      expiresAt: "2026-06-27T00:00:00.000Z",
      lastActiveAt: "2026-06-26T00:00:00.000Z",
    });

    await repo.sessions.touch("session-1", "2026-06-26T01:00:00.000Z");

    expect((await repo.sessions.findById("session-1"))?.lastActiveAt).toBe(
      "2026-06-26T01:00:00.000Z",
    );
    expect(await repo.sessions.listByUserId("user-1")).toHaveLength(1);
    expect(await repo.sessions.revoke("session-1")).toBe(true);
    expect(await repo.sessions.findById("session-1")).toBeNull();
  });

  it("revokes all user sessions except an optional current session", async () => {
    const repo = await createRepositories();
    await repo.users.create({
      id: "user-1",
      username: "user",
      passwordHash: "hash",
      isAdmin: false,
      isOidc: false,
    });

    for (const id of ["keep", "drop-1", "drop-2"]) {
      await repo.sessions.create({
        id,
        userId: "user-1",
        jwtToken: `${id}-token`,
        deviceType: "desktop",
        deviceInfo: "Firefox",
        expiresAt: "2026-06-27T00:00:00.000Z",
      });
    }

    expect(await repo.sessions.revokeAllForUser("user-1", "keep")).toBe(2);
    expect(
      (await repo.sessions.listByUserId("user-1")).map((s) => s.id),
    ).toEqual(["keep"]);
  });

  it("deletes expired sessions", async () => {
    const repo = await createRepositories();
    await repo.users.create({
      id: "user-1",
      username: "user",
      passwordHash: "hash",
      isAdmin: false,
      isOidc: false,
    });

    await repo.sessions.create({
      id: "expired",
      userId: "user-1",
      jwtToken: "expired-token",
      deviceType: "desktop",
      deviceInfo: "Firefox",
      expiresAt: "2026-06-25T00:00:00.000Z",
    });
    await repo.sessions.create({
      id: "active",
      userId: "user-1",
      jwtToken: "active-token",
      deviceType: "desktop",
      deviceInfo: "Firefox",
      expiresAt: "2026-06-27T00:00:00.000Z",
    });

    expect(
      await repo.sessions.deleteExpired(new Date("2026-06-26T00:00:00.000Z")),
    ).toBe(1);
    expect(
      (await repo.sessions.listByUserId("user-1")).map((s) => s.id),
    ).toEqual(["active"]);
  });
});
