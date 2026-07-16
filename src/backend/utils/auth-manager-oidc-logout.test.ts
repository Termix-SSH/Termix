import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sqlite: null as {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      all: () => Array<Record<string, unknown>>;
      run: (...values: unknown[]) => unknown;
    };
  } | null,
  saveDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../database/db/index.js", async () => {
  const { default: Database } = await import("better-sqlite3");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const sqlite = new Database(":memory:");
  mocks.sqlite = sqlite;
  const db = drizzle(sqlite);
  return {
    db,
    getDb: () => db,
    saveMemoryDatabaseToFile: mocks.saveDatabase,
  };
});

vi.mock("./user-keys.js", () => ({
  UserKeyManager: {
    getInstance: () => ({
      invalidate: vi.fn(),
      tryGetUserDEK: vi.fn(() => null),
      hasUserDEK: vi.fn(() => true),
    }),
  },
}));

vi.mock("./system-crypto.js", () => ({
  SystemCrypto: { getInstance: () => ({}) },
}));

vi.mock("./data-crypto.js", () => ({
  DataCrypto: { getInstance: () => ({}) },
}));

vi.mock("./logger.js", () => ({
  authLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  databaseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const { AuthManager } = await import("./auth-manager.js");
const authManager = AuthManager.getInstance();

type SessionInput = {
  id: string;
  userId: string;
  sub: string;
  sid: string | null;
  providerId: number | null;
};

function insertSession({ id, userId, sub, sid, providerId }: SessionInput) {
  mocks
    .sqlite!.prepare(
      `INSERT INTO sessions (
        id, user_id, jwt_token, device_type, device_info,
        oidc_sub, oidc_sid, sso_provider_id,
        created_at, expires_at, last_active_at
      ) VALUES (?, ?, ?, 'browser', 'test', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      `token-${id}`,
      sub,
      sid,
      providerId,
      "2026-07-10T00:00:00.000Z",
      "2026-07-11T00:00:00.000Z",
      "2026-07-10T00:00:00.000Z",
    );
}

function sessionIds(): string[] {
  return mocks
    .sqlite!.prepare("SELECT id FROM sessions ORDER BY id")
    .all()
    .map((row) => String(row.id));
}

describe("AuthManager.revokeSessionsByOidc", () => {
  beforeAll(() => {
    mocks.sqlite!.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        jwt_token TEXT NOT NULL,
        device_type TEXT NOT NULL,
        device_info TEXT NOT NULL,
        oidc_sub TEXT,
        oidc_sid TEXT,
        sso_provider_id INTEGER,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL
      )
    `);
  });

  beforeEach(() => {
    mocks.sqlite!.exec("DELETE FROM sessions");
    mocks.saveDatabase.mockReset().mockResolvedValue(undefined);
  });

  it("revokes only the matching provider session when sid is present", async () => {
    insertSession({
      id: "matching",
      userId: "user-1",
      sub: "subject-1",
      sid: "session-1",
      providerId: 7,
    });
    insertSession({
      id: "other-provider",
      userId: "user-1",
      sub: "subject-1",
      sid: "session-1",
      providerId: 8,
    });
    insertSession({
      id: "other-session",
      userId: "user-1",
      sub: "subject-1",
      sid: "session-2",
      providerId: 7,
    });

    await expect(
      authManager.revokeSessionsByOidc({
        ssoProviderId: 7,
        sub: "subject-1",
        sid: "session-1",
      }),
    ).resolves.toBe(1);

    expect(sessionIds()).toEqual(["other-provider", "other-session"]);
  });

  it("revokes all provider sessions for a subject when sid is absent", async () => {
    insertSession({
      id: "first",
      userId: "user-1",
      sub: "subject-1",
      sid: "session-1",
      providerId: 7,
    });
    insertSession({
      id: "second",
      userId: "user-1",
      sub: "subject-1",
      sid: "session-2",
      providerId: 7,
    });
    insertSession({
      id: "other-subject",
      userId: "user-2",
      sub: "subject-2",
      sid: null,
      providerId: 7,
    });

    await expect(
      authManager.revokeSessionsByOidc({
        ssoProviderId: 7,
        sub: "subject-1",
      }),
    ).resolves.toBe(2);

    expect(sessionIds()).toEqual(["other-subject"]);
  });

  it("does not persist when no session matches", async () => {
    await expect(
      authManager.revokeSessionsByOidc({
        ssoProviderId: 7,
        sid: "missing",
      }),
    ).resolves.toBe(0);

    expect(mocks.saveDatabase).not.toHaveBeenCalled();
  });

  it("propagates persistence failures so the provider can retry", async () => {
    insertSession({
      id: "matching",
      userId: "user-1",
      sub: "subject-1",
      sid: "session-1",
      providerId: 7,
    });
    mocks.saveDatabase.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      authManager.revokeSessionsByOidc({
        ssoProviderId: 7,
        sid: "session-1",
      }),
    ).rejects.toThrow("disk full");
  });
});
