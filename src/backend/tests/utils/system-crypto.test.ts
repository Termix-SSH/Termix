import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  ExternalSecretError,
  SystemCrypto,
} from "../../utils/system-crypto.js";

const NAMES = [
  "DATA_DIR",
  "TERMIX_REQUIRE_EXTERNAL_SECRETS",
  ...[
    "JWT_SECRET",
    "DATABASE_KEY",
    "ENCRYPTION_KEY",
    "INTERNAL_AUTH_TOKEN",
  ].flatMap((n) => [n, `${n}_FILE`, `${n}_PREVIOUS`, `${n}_PREVIOUS_FILE`]),
];
const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
const crypto = SystemCrypto.getInstance();
const hex = (byte: number) => Buffer.alloc(32, byte).toString("hex");
let dir: string;

beforeEach(() => {
  for (const n of NAMES) delete process.env[n];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-syscrypto-"));
  process.env.DATA_DIR = dir;
  crypto.resetForTests();
});

afterAll(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
  crypto.resetForTests();
});

const envFile = () => fs.readFileSync(path.join(dir, ".env"), "utf8");

describe("first start", () => {
  it("makes every key once and keeps them in .env", async () => {
    const jwt = await crypto.getJWTSecret();
    const db = await crypto.getDatabaseKey();
    const enc = await crypto.getEncryptionKey();
    const internal = await crypto.getInternalAuthToken();
    expect(jwt).toHaveLength(64);
    expect(db).toHaveLength(32);
    expect(enc).toHaveLength(32);
    expect(internal).toHaveLength(64);
    const content = envFile();
    expect(content).toContain(`JWT_SECRET=${jwt}`);
    expect(content).toContain(`DATABASE_KEY=${db.toString("hex")}`);
    if (process.platform !== "win32") {
      expect(fs.statSync(path.join(dir, ".env")).mode & 0o777).toBe(0o600);
    }

    crypto.resetForTests();
    for (const n of [
      "JWT_SECRET",
      "DATABASE_KEY",
      "ENCRYPTION_KEY",
      "INTERNAL_AUTH_TOKEN",
    ]) {
      delete process.env[n];
    }
    expect(await crypto.getJWTSecret()).toBe(jwt);
    expect((await crypto.getDatabaseKey()).equals(db)).toBe(true);
    expect((await crypto.getEncryptionKey()).equals(enc)).toBe(true);
    expect(await crypto.getInternalAuthToken()).toBe(internal);
  });

  it("replaces a too short secret in .env", async () => {
    fs.writeFileSync(path.join(dir, ".env"), "JWT_SECRET=short\n");
    const jwt = await crypto.getJWTSecret();
    expect(jwt).not.toBe("short");
    expect(envFile()).toContain(`JWT_SECRET=${jwt}`);
  });
});

describe("secrets from outside", () => {
  it("uses environment variables and _FILE secrets", async () => {
    process.env.JWT_SECRET = "j".repeat(64);
    process.env.DATABASE_KEY = hex(2);
    const file = path.join(dir, "enc.key");
    fs.writeFileSync(file, `${hex(3)}\n`);
    process.env.ENCRYPTION_KEY_FILE = file;
    process.env.INTERNAL_AUTH_TOKEN = "i".repeat(40);
    expect(await crypto.getJWTSecret()).toBe("j".repeat(64));
    expect((await crypto.getDatabaseKey()).toString("hex")).toBe(hex(2));
    expect((await crypto.getEncryptionKey()).toString("hex")).toBe(hex(3));
    expect(await crypto.getInternalAuthToken()).toBe("i".repeat(40));
    expect(fs.existsSync(path.join(dir, ".env"))).toBe(false);
    expect(await crypto.isExternalSecret("ENCRYPTION_KEY")).toBe(true);
    expect(await crypto.isExternalSecret("JWT_SECRET")).toBe(true);
  });

  it("refuses short secret files and keys that are not 64 hex characters", async () => {
    const file = path.join(dir, "jwt");
    fs.writeFileSync(file, "tiny");
    process.env.JWT_SECRET_FILE = file;
    await expect(crypto.getJWTSecret()).rejects.toThrow(
      "JWT secret initialization failed",
    );
    process.env.DATABASE_KEY = "z".repeat(64);
    await expect(crypto.getDatabaseKey()).rejects.toThrow(
      "Database key initialization failed",
    );
  });

  it("refuses to make keys when they must come from outside", async () => {
    process.env.TERMIX_REQUIRE_EXTERNAL_SECRETS = "true";
    await expect(crypto.getJWTSecret()).rejects.toThrow();
    await expect(crypto.getDatabaseKey()).rejects.toThrow();
    await expect(crypto.getEncryptionKey()).rejects.toThrow();
    await expect(crypto.getInternalAuthToken()).rejects.toThrow();
    expect(fs.existsSync(path.join(dir, ".env"))).toBe(false);
  });
});

describe("previous keys", () => {
  it("reads them from the environment, a file and .env", async () => {
    process.env.ENCRYPTION_KEY_PREVIOUS = `${hex(4)}, ${hex(5)}`;
    const file = path.join(dir, "prev");
    fs.writeFileSync(file, hex(6));
    process.env.ENCRYPTION_KEY_PREVIOUS_FILE = file;
    const keys = await crypto.getPreviousKeys("ENCRYPTION_KEY");
    expect(keys.map((k) => k.toString("hex"))).toEqual([
      hex(4),
      hex(5),
      hex(6),
    ]);

    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    delete process.env.ENCRYPTION_KEY_PREVIOUS_FILE;
    fs.writeFileSync(
      path.join(dir, ".env"),
      `DATABASE_KEY_PREVIOUS=${hex(7)}\n`,
    );
    expect(
      (await crypto.getPreviousKeys("DATABASE_KEY")).map((k) =>
        k.toString("hex"),
      ),
    ).toEqual([hex(7)]);
    process.env.DATABASE_KEY_PREVIOUS = "nothex";
    await expect(crypto.getPreviousKeys("DATABASE_KEY")).rejects.toThrow(
      "64 hexadecimal",
    );
  });

  it("refuses a current key that is also listed as previous", async () => {
    process.env.ENCRYPTION_KEY = hex(8);
    process.env.ENCRYPTION_KEY_PREVIOUS = hex(8);
    await expect(crypto.getEncryptionKey()).rejects.toThrow(
      "ENCRYPTION_KEY_PREVIOUS",
    );
  });
});

describe("rotation", () => {
  it("rotates the JWT secret kept in .env", async () => {
    const before = await crypto.getJWTSecret();
    await crypto.rotateJWTSecret();
    const after = await crypto.getJWTSecret();
    expect(after).not.toBe(before);
    expect(envFile()).toContain(`JWT_SECRET=${after}`);
    expect(await crypto.validateJWTSecret()).toBe(true);
    expect(await crypto.getSystemKeyStatus()).toMatchObject({
      hasSecret: true,
      isValid: true,
      algorithm: "HS256",
    });
  });

  it("keeps the old encryption key as previous until forgotten", async () => {
    const first = await crypto.getEncryptionKey();
    const second = await crypto.rotateEncryptionKey();
    expect(second.equals(first)).toBe(false);
    expect(envFile()).toContain(
      `ENCRYPTION_KEY_PREVIOUS=${first.toString("hex")}`,
    );
    const third = await crypto.rotateEncryptionKey();
    expect(envFile()).toContain(
      `ENCRYPTION_KEY_PREVIOUS=${second.toString("hex")},${first.toString("hex")}`,
    );
    expect((await crypto.getEncryptionKey()).equals(third)).toBe(true);
    await crypto.forgetPreviousEncryptionKeys();
    expect(envFile()).toMatch(/^ENCRYPTION_KEY_PREVIOUS=$/m);
  });

  it("refuses to rotate secrets that are set outside .env", async () => {
    process.env.JWT_SECRET = "x".repeat(64);
    await expect(crypto.rotateJWTSecret()).rejects.toBeInstanceOf(
      ExternalSecretError,
    );
    process.env.ENCRYPTION_KEY_FILE = path.join(dir, "k");
    await expect(crypto.rotateEncryptionKey()).rejects.toBeInstanceOf(
      ExternalSecretError,
    );
  });

  it("does nothing when there is no previous key to forget", async () => {
    await crypto.forgetPreviousEncryptionKeys();
    expect(fs.existsSync(path.join(dir, ".env"))).toBe(false);
  });
});
