import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ drizzle: null as unknown }));

vi.mock("../../../database/db/index.js", () => ({
  getDb: () => state.drizzle,
  getSqlite: () => null,
}));
vi.mock("../../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    triggerSave: vi.fn(),
    forceSave: vi.fn(async () => {}),
  },
}));
vi.mock("../../../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({ getEncryptionKey: async () => Buffer.alloc(32, 5) }),
  },
}));

const { TestSqliteDatabase } =
  await import("../../database/repositories/test-support.js");
const { createLink, deleteLink, getLink, listLinks, updateLink } =
  await import("../../../sync/client/link-store.js");
const { setActiveUserId } = await import("../../../sync/accounts.js");

let db: InstanceType<typeof TestSqliteDatabase>;

beforeEach(async () => {
  db = new TestSqliteDatabase("sqlite");
  state.drizzle = (await db.connect()).drizzle;
  await db.run(
    sql`INSERT INTO users (id, username, password_hash) VALUES ('local', 'local', '')`,
  );
});

afterEach(async () => {
  await db.close();
});

describe("the desktop's link", () => {
  it("stores secrets encrypted and reads them back", async () => {
    await createLink({
      userId: "local",
      serverUrl: "https://termix.example",
      sessionToken: "session-token",
      customHeaders: [{ name: "CF-Access-Client-Secret", value: "shh-secret" }],
      basicAuth: { username: "gate", password: "pw" },
    });

    const [raw] = await db.query<Record<string, string>>(
      sql`SELECT session_token, custom_headers, basic_auth FROM sync_link`,
    );
    for (const value of Object.values(raw)) {
      expect(value).toMatch(/^sysenc:v1:/);
      expect(value).not.toContain("shh-secret");
    }

    const link = await getLink();
    expect(link).toMatchObject({
      sessionToken: "session-token",
      customHeaders: [{ name: "CF-Access-Client-Secret", value: "shh-secret" }],
      basicAuth: { username: "gate", password: "pw" },
      cursor: 0,
      knownTypes: [],
      disabledTypes: [],
      status: "idle",
    });
  });

  it("keeps one link at a time and updates it in place", async () => {
    await createLink({
      userId: "local",
      serverUrl: "https://a",
      sessionToken: "a",
    });
    await createLink({
      userId: "local",
      serverUrl: "https://b",
      sessionToken: "b",
    });
    await updateLink({
      cursor: 42,
      disabledTypes: ["hosts"],
      status: "offline",
    });

    const link = await getLink();
    expect(link?.serverUrl).toBe("https://b");
    expect(link?.cursor).toBe(42);
    expect(link?.disabledTypes).toEqual(["hosts"]);
    expect(link?.status).toBe("offline");

    await deleteLink();
    expect(await getLink()).toBeNull();
    expect(await updateLink({ cursor: 1 })).toBeNull();
  });
});

describe("several links", () => {
  beforeEach(async () => {
    await db.run(sql`UPDATE users SET is_admin = 1 WHERE id = 'local'`);
    await db.run(
      sql`INSERT INTO users (id, username, password_hash) VALUES ('second', 'second', '')`,
    );
  });

  it("keeps one link per local user", async () => {
    await createLink({
      userId: "local",
      serverUrl: "https://a",
      sessionToken: "a",
    });
    await createLink({
      userId: "second",
      serverUrl: "https://b",
      sessionToken: "b",
    });
    expect((await listLinks()).map((link) => link.serverUrl).sort()).toEqual([
      "https://a",
      "https://b",
    ]);
    expect((await getLink("second"))?.serverUrl).toBe("https://b");
    expect((await getLink("local"))?.serverUrl).toBe("https://a");
  });

  it("answers for the active account when no user is given", async () => {
    await createLink({
      userId: "local",
      serverUrl: "https://a",
      sessionToken: "a",
    });
    await createLink({
      userId: "second",
      serverUrl: "https://b",
      sessionToken: "b",
    });
    expect((await getLink())?.serverUrl).toBe("https://a");
    await setActiveUserId("second");
    expect((await getLink())?.serverUrl).toBe("https://b");
  });

  it("changes and removes only the link it is asked about", async () => {
    await createLink({
      userId: "local",
      serverUrl: "https://a",
      sessionToken: "a",
    });
    await createLink({
      userId: "second",
      serverUrl: "https://b",
      sessionToken: "b",
    });
    await updateLink({ cursor: 9, status: "offline" }, "second");
    expect((await getLink("local"))?.cursor).toBe(0);
    expect((await getLink("second"))?.cursor).toBe(9);
    await deleteLink("second");
    expect(await getLink("second")).toBeNull();
    expect((await getLink("local"))?.serverUrl).toBe("https://a");
  });

  it("stores connection options without touching the type switches", async () => {
    await createLink({
      userId: "local",
      serverUrl: "https://a",
      sessionToken: "a",
    });
    await updateLink({ disabledTypes: ["hosts"] }, "local");
    await updateLink({ options: { clientCertificate: "work" } }, "local");
    const link = await getLink("local");
    expect(link?.options).toEqual({ clientCertificate: "work" });
    expect(link?.disabledTypes).toEqual(["hosts"]);
  });
});
