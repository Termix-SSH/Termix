/**
 * The rotation pass over a real SQLite database: every sealed value in any
 * text column of any table moves to the current key, and values no key opens
 * are counted, not lost.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  db: null as unknown,
  rewrapAll: vi.fn(async () => 2),
  forceSave: vi.fn(async () => {}),
}));

vi.mock("../../database/db/index.js", () => ({ getDb: () => mocks.db }));
vi.mock("../../database/db/dialect.js", async (orig) => ({
  ...(await orig<object>()),
  resolveDatabaseDialect: () => "sqlite",
}));
vi.mock("../../utils/user-keys.js", () => ({
  UserKeyManager: {
    getInstance: () => ({
      rewrapAll: mocks.rewrapAll,
      initialize: async () => {},
    }),
  },
}));
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave: mocks.forceSave },
}));
vi.mock("../../sync/store.js", () => ({ resetHashKey: () => {} }));

const { SystemCrypto } = await import("../../utils/system-crypto.js");
const { encryptSystemSecret, decryptSystemSecret } =
  await import("../../utils/system-secret-crypto.js");
const { runKeyRotation, resealText, rotateEncryptionKey } =
  await import("../../utils/key-rotation.js");

const hex = (b: number) => Buffer.alloc(32, b).toString("hex");
const NAMES = [
  "DATA_DIR",
  "ENCRYPTION_KEY",
  "ENCRYPTION_KEY_PREVIOUS",
  "DATABASE_KEY",
  "DATABASE_KEY_PREVIOUS",
];
const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
const system = SystemCrypto.getInstance();
let sqlite: Database.Database;

function useKeys(current: number, previous?: number[]) {
  process.env.ENCRYPTION_KEY = hex(current);
  if (previous)
    process.env.ENCRYPTION_KEY_PREVIOUS = previous.map(hex).join(",");
  else delete process.env.ENCRYPTION_KEY_PREVIOUS;
  system.resetForTests();
}

beforeEach(() => {
  for (const n of NAMES) delete process.env[n];
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "termix-rot-"));
  sqlite = new Database(":memory:");
  sqlite.exec(
    "create table settings (key text, value text); create table p_demo_things (id integer, blob_json text, n integer)",
  );
  mocks.db = drizzle(sqlite);
  mocks.rewrapAll.mockClear();
  mocks.forceSave.mockClear();
});

afterAll(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
  system.resetForTests();
});

describe("runKeyRotation", () => {
  it("does nothing without previous keys", async () => {
    useKeys(1);
    expect(await runKeyRotation()).toBeNull();
    expect(mocks.forceSave).not.toHaveBeenCalled();
  });

  it("reseals values in every table and counts ones no key opens", async () => {
    useKeys(1);
    const a = await encryptSystemSecret("sso-secret");
    const b = await encryptSystemSecret("plugin-secret");
    useKeys(9);
    const lost = await encryptSystemSecret("unknown-key");
    useKeys(2, [1]);
    sqlite.prepare("insert into settings values (?, ?)").run("sso", a);
    sqlite
      .prepare("insert into p_demo_things values (?, ?, ?)")
      .run(1, JSON.stringify({ token: b, other: "x" }), 5);
    sqlite.prepare("insert into settings values (?, ?)").run("lost", lost);

    const result = await runKeyRotation();
    expect(result).toEqual({
      rewrappedKeys: 2,
      resealedValues: 2,
      failedValues: 1,
    });
    expect(mocks.forceSave).toHaveBeenCalledWith("key_rotation");

    useKeys(2);
    const sso = sqlite
      .prepare("select value from settings where key = 'sso'")
      .get() as { value: string };
    expect(sso.value).not.toBe(a);
    expect(await decryptSystemSecret(sso.value)).toBe("sso-secret");
    const row = sqlite.prepare("select blob_json from p_demo_things").get() as {
      blob_json: string;
    };
    const json = JSON.parse(row.blob_json);
    expect(json.other).toBe("x");
    expect(await decryptSystemSecret(json.token)).toBe("plugin-secret");
    const kept = sqlite
      .prepare("select value from settings where key = 'lost'")
      .get() as { value: string };
    expect(kept.value).toBe(lost);
  });

  it("only saves the file again for a database key rotation", async () => {
    useKeys(1);
    process.env.DATABASE_KEY = hex(3);
    process.env.DATABASE_KEY_PREVIOUS = hex(4);
    expect(await runKeyRotation()).toEqual({
      rewrappedKeys: 0,
      resealedValues: 0,
      failedValues: 0,
    });
    expect(mocks.rewrapAll).not.toHaveBeenCalled();
    expect(mocks.forceSave).toHaveBeenCalled();
  });
});

describe("resealText", () => {
  it("leaves text with no sealed values alone", async () => {
    useKeys(1);
    expect(await resealText("nothing here")).toEqual({
      text: "nothing here",
      changed: 0,
      failed: 0,
    });
  });
});

describe("rotateEncryptionKey", () => {
  it("makes a new key, moves every value and drops the old key on SQLite", async () => {
    fs.writeFileSync(
      path.join(process.env.DATA_DIR!, ".env"),
      `ENCRYPTION_KEY=${hex(1)}\n`,
    );
    system.resetForTests();
    const sealed = await encryptSystemSecret("value");
    sqlite.prepare("insert into settings values (?, ?)").run("k", sealed);
    const result = await rotateEncryptionKey();
    expect(result.resealedValues).toBe(1);
    expect(result.failedValues).toBe(0);
    const env = fs.readFileSync(
      path.join(process.env.DATA_DIR!, ".env"),
      "utf8",
    );
    expect(env).not.toContain(`ENCRYPTION_KEY=${hex(1)}`);
    expect(env).toMatch(/^ENCRYPTION_KEY_PREVIOUS=$/m);
    const stored = sqlite.prepare("select value from settings").get() as {
      value: string;
    };
    expect(await decryptSystemSecret(stored.value)).toBe("value");
  });
});
