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
const { createLink, deleteLink, getLink, updateLink } =
  await import("../../../sync/client/link-store.js");

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
      customHeaders: [{ name: "CF-Access-Client-Secret", value: "shh" }],
      basicAuth: { username: "gate", password: "pw" },
    });

    const [raw] = await db.query<Record<string, string>>(
      sql`SELECT session_token, custom_headers, basic_auth FROM sync_link`,
    );
    for (const value of Object.values(raw)) {
      expect(value).toMatch(/^sysenc:v1:/);
      expect(value).not.toContain("shh");
    }

    const link = await getLink();
    expect(link).toMatchObject({
      sessionToken: "session-token",
      customHeaders: [{ name: "CF-Access-Client-Secret", value: "shh" }],
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
