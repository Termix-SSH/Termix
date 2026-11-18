import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsStore = new Map<string, string>();

vi.mock("../../database/repositories/factory.js", () => ({
  getCurrentSettingValue: (key: string) => settingsStore.get(key) ?? null,
  createCurrentSettingsRepository: () => ({
    upsert: async (key: string, value: string) => {
      settingsStore.set(key, value);
    },
    delete: async (key: string) => {
      settingsStore.delete(key);
    },
    listAll: async () =>
      [...settingsStore].map(([key, value]) => ({ key, value })),
  }),
}));

const { SystemCrypto } = await import("../../utils/system-crypto.js");
const { encryptSystemSecret, decryptSystemSecret, resealSystemSecret } =
  await import("../../utils/system-secret-crypto.js");
const { UserKeyManager, userDekSettingsKey } =
  await import("../../utils/user-keys.js");
const { resealText } = await import("../../utils/key-rotation.js");
const { DatabaseFileEncryption } =
  await import("../../utils/database-file-encryption.js");

const hex = () => crypto.randomBytes(32).toString("hex");
const ENV_NAMES = [
  "DATA_DIR",
  "ENCRYPTION_KEY",
  "ENCRYPTION_KEY_PREVIOUS",
  "DATABASE_KEY",
  "DATABASE_KEY_PREVIOUS",
  "JWT_SECRET",
];
const savedEnv: Record<string, string | undefined> = {};
let dataDir: string;

beforeEach(() => {
  for (const name of ENV_NAMES) savedEnv[name] = process.env[name];
  for (const name of ENV_NAMES) delete process.env[name];
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-rotate-"));
  process.env.DATA_DIR = dataDir;
  settingsStore.clear();
  SystemCrypto.getInstance().resetForTests();
});

afterEach(() => {
  for (const name of ENV_NAMES) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  SystemCrypto.getInstance().resetForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function writeDotEnv(lines: Record<string, string>): void {
  fs.writeFileSync(
    path.join(dataDir, ".env"),
    Object.entries(lines)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
}

describe("encryption key rotation", () => {
  it("opens values sealed with a previous key and re-seals them", async () => {
    const oldKey = hex();
    process.env.ENCRYPTION_KEY = oldKey;
    const sealed = await encryptSystemSecret("oidc-client-secret");

    SystemCrypto.getInstance().resetForTests();
    process.env.ENCRYPTION_KEY = hex();
    await expect(decryptSystemSecret(sealed)).rejects.toThrow();

    process.env.ENCRYPTION_KEY_PREVIOUS = oldKey;
    await expect(decryptSystemSecret(sealed)).resolves.toBe(
      "oidc-client-secret",
    );

    const moved = await resealSystemSecret(sealed);
    expect(moved).not.toBeNull();
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    await expect(decryptSystemSecret(moved!)).resolves.toBe(
      "oidc-client-secret",
    );
    // Already on the current key: nothing to do.
    await expect(resealSystemSecret(moved!)).resolves.toBeNull();
  });

  it("re-seals every sealed value inside JSON text", async () => {
    const oldKey = hex();
    process.env.ENCRYPTION_KEY = oldKey;
    const a = await encryptSystemSecret("a");
    const b = await encryptSystemSecret("b");
    const json = JSON.stringify({ token: a, nested: [b], plain: "x" });

    SystemCrypto.getInstance().resetForTests();
    process.env.ENCRYPTION_KEY = hex();
    process.env.ENCRYPTION_KEY_PREVIOUS = oldKey;
    const result = await resealText(json);
    expect(result.changed).toBe(2);
    expect(result.failed).toBe(0);

    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    const parsed = JSON.parse(result.text);
    await expect(decryptSystemSecret(parsed.token)).resolves.toBe("a");
    await expect(decryptSystemSecret(parsed.nested[0])).resolves.toBe("b");
    expect(parsed.plain).toBe("x");
  });

  it("counts values no known key opens and leaves them alone", async () => {
    process.env.ENCRYPTION_KEY = hex();
    const sealed = await encryptSystemSecret("lost");
    SystemCrypto.getInstance().resetForTests();
    process.env.ENCRYPTION_KEY = hex();
    const result = await resealText(`x ${sealed}`);
    expect(result).toEqual({ text: `x ${sealed}`, changed: 0, failed: 1 });
  });

  it("re-wraps user data keys made with the previous key", async () => {
    const oldKey = crypto.randomBytes(32);
    const manager = UserKeyManager.getInstance();
    await manager.initialize(oldKey);
    const dek = await manager.createUserDEK("user-1");
    const before = settingsStore.get(userDekSettingsKey("user-1"));

    process.env.ENCRYPTION_KEY = hex();
    process.env.ENCRYPTION_KEY_PREVIOUS = oldKey.toString("hex");
    await manager.initialize();
    expect(manager.getUserDEK("user-1").equals(dek)).toBe(true);

    await expect(manager.rewrapAll()).resolves.toBe(1);
    expect(settingsStore.get(userDekSettingsKey("user-1"))).not.toBe(before);
    await expect(manager.rewrapAll()).resolves.toBe(0);

    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    await manager.initialize();
    expect(manager.getUserDEK("user-1").equals(dek)).toBe(true);
  });

  it("rotates a key kept in .env and keeps the old one as previous", async () => {
    const oldKey = hex();
    writeDotEnv({ ENCRYPTION_KEY: oldKey });
    const system = SystemCrypto.getInstance();
    const sealed = await encryptSystemSecret("value");

    await system.rotateEncryptionKey();
    const env = fs.readFileSync(path.join(dataDir, ".env"), "utf8");
    expect(env).toContain(`ENCRYPTION_KEY_PREVIOUS=${oldKey}`);
    expect(env).not.toContain(`ENCRYPTION_KEY=${oldKey}\n`);
    await expect(decryptSystemSecret(sealed)).resolves.toBe("value");

    await system.forgetPreviousEncryptionKeys();
    await expect(system.getPreviousKeys("ENCRYPTION_KEY")).resolves.toEqual([]);
  });

  it("refuses to rotate a key that comes from the environment", async () => {
    process.env.ENCRYPTION_KEY = hex();
    await expect(
      SystemCrypto.getInstance().rotateEncryptionKey(),
    ).rejects.toMatchObject({ name: "ExternalSecretError" });
  });
});

describe("JWT secret rotation", () => {
  it("replaces the secret in .env", async () => {
    const old = "a".repeat(64);
    writeDotEnv({ JWT_SECRET: old });
    const system = SystemCrypto.getInstance();
    expect(await system.getJWTSecret()).toBe(old);

    await system.rotateJWTSecret();
    const next = await system.getJWTSecret();
    expect(next).not.toBe(old);
    expect(fs.readFileSync(path.join(dataDir, ".env"), "utf8")).toContain(
      `JWT_SECRET=${next}`,
    );
  });

  it("refuses a secret set through the environment", async () => {
    process.env.JWT_SECRET = "b".repeat(64);
    await expect(
      SystemCrypto.getInstance().rotateJWTSecret(),
    ).rejects.toMatchObject({ name: "ExternalSecretError" });
  });
});

describe("database key rotation", () => {
  it("opens a file sealed with DATABASE_KEY_PREVIOUS", async () => {
    const oldKey = hex();
    process.env.DATABASE_KEY = oldKey;
    const file = path.join(dataDir, "db.sqlite.encrypted");
    const plain = Buffer.from("SQLite format 3 bytes");
    await DatabaseFileEncryption.encryptDatabaseFromBuffer(plain, file);

    SystemCrypto.getInstance().resetForTests();
    process.env.DATABASE_KEY = hex();
    await expect(
      DatabaseFileEncryption.decryptDatabaseToBuffer(file),
    ).rejects.toThrow();

    process.env.DATABASE_KEY_PREVIOUS = `${hex()},${oldKey}`;
    const opened = await DatabaseFileEncryption.decryptDatabaseToBuffer(file);
    expect(opened.equals(plain)).toBe(true);
  });
});
