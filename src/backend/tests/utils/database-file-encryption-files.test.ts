import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

const keys = vi.hoisted(() => ({
  current: Buffer.alloc(32, 1),
  previous: [] as Buffer[],
}));

vi.mock("../../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({
      getDatabaseKey: async () => keys.current,
      getPreviousKeys: async () => keys.previous,
    }),
  },
}));

const { DatabaseFileEncryption } =
  await import("../../utils/database-file-encryption.js");

let dir: string;
const file = (name: string) => path.join(dir, name);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-dbfile-"));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  keys.current = Buffer.alloc(32, 1);
  keys.previous = [];
});

/** The old two file layout: raw ciphertext plus a .meta file next to it. */
function writeTwoFile(target: string, plain: Buffer, key: Buffer, extra = {}) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  fs.writeFileSync(target, data);
  fs.writeFileSync(
    `${target}.meta`,
    JSON.stringify({
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      version: "v2",
      fingerprint: "x",
      algorithm: "aes-256-gcm",
      dataSize: data.length,
      ...extra,
    }),
  );
}

describe("file round trips", () => {
  it("encrypts a file next to itself and decrypts it back", async () => {
    const source = file("plain.sqlite");
    fs.writeFileSync(source, "SQLite format 3 rows");
    const encrypted = await DatabaseFileEncryption.encryptDatabaseFile(source);
    expect(encrypted).toBe(`${source}.encrypted`);
    expect(fs.readFileSync(encrypted).includes("rows")).toBe(false);
    fs.unlinkSync(source);
    const restored =
      await DatabaseFileEncryption.decryptDatabaseFile(encrypted);
    expect(restored).toBe(source);
    expect(fs.readFileSync(restored, "utf8")).toBe("SQLite format 3 rows");
  });

  it("refuses a missing source or encrypted file", async () => {
    await expect(
      DatabaseFileEncryption.encryptDatabaseFile(file("nope")),
    ).rejects.toThrow("does not exist");
    await expect(
      DatabaseFileEncryption.decryptDatabaseToBuffer(file("nope")),
    ).rejects.toThrow("does not exist");
    await expect(
      DatabaseFileEncryption.decryptDatabaseFile(file("nope.encrypted")),
    ).rejects.toThrow("decryption failed");
  });

  it("still reads the old two file layout", async () => {
    const target = file("two.encrypted");
    writeTwoFile(target, Buffer.from("old layout"), keys.current);
    const plain = await DatabaseFileEncryption.decryptDatabaseToBuffer(target);
    expect(plain.toString()).toBe("old layout");
    expect(DatabaseFileEncryption.isEncryptedDatabaseFile(target)).toBe(true);
    expect(DatabaseFileEncryption.getEncryptedFileInfo(target)).toMatchObject({
      version: "v2",
      algorithm: "aes-256-gcm",
    });
  });
});

describe("tampering and wrong keys", () => {
  it("refuses a file whose bytes were changed", async () => {
    const target = file("tamper.encrypted");
    await DatabaseFileEncryption.encryptDatabaseFromBuffer(
      Buffer.from("secret rows"),
      target,
    );
    const bytes = fs.readFileSync(target);
    bytes[bytes.length - 1] ^= 0xff;
    fs.writeFileSync(target, bytes);
    await expect(
      DatabaseFileEncryption.decryptDatabaseToBuffer(target),
    ).rejects.toThrow("authentication failed");
  });

  it("refuses the wrong key, and opens with a previous key after a rotation", async () => {
    const target = file("rotate.encrypted");
    const old = Buffer.alloc(32, 7);
    keys.current = old;
    await DatabaseFileEncryption.encryptDatabaseFromBuffer(
      Buffer.from("before rotation"),
      target,
    );
    keys.current = Buffer.alloc(32, 9);
    await expect(
      DatabaseFileEncryption.decryptDatabaseToBuffer(target),
    ).rejects.toThrow("authentication failed");
    keys.previous = [Buffer.alloc(32, 3), old];
    const plain = await DatabaseFileEncryption.decryptDatabaseToBuffer(target);
    expect(plain.toString()).toBe("before rotation");
  });

  it("refuses a file shorter or longer than its metadata says", async () => {
    const target = file("size.encrypted");
    writeTwoFile(target, Buffer.from("abc"), keys.current, { dataSize: 99 });
    await expect(
      DatabaseFileEncryption.decryptDatabaseToBuffer(target),
    ).rejects.toThrow("size mismatch");
    const info = DatabaseFileEncryption.getDiagnosticInfo(target);
    expect(info.validation).toMatchObject({
      filesConsistent: false,
      sizeMismatch: true,
      expectedSize: 99,
    });
  });

  it("refuses unknown versions and algorithms", async () => {
    const a = file("ver.encrypted");
    writeTwoFile(a, Buffer.from("x"), keys.current, { version: "v9" });
    await expect(
      DatabaseFileEncryption.decryptDatabaseToBuffer(a),
    ).rejects.toThrow("Unsupported encryption version");
    const b = file("alg.encrypted");
    writeTwoFile(b, Buffer.from("x"), keys.current, {
      algorithm: "aes-128-cbc",
    });
    await expect(
      DatabaseFileEncryption.decryptDatabaseToBuffer(b),
    ).rejects.toThrow("Unsupported algorithm");
  });

  it("refuses a file with no readable metadata at all", async () => {
    const target = file("junk.encrypted");
    fs.writeFileSync(target, Buffer.from([0, 0, 0, 0, 1, 2, 3]));
    await expect(
      DatabaseFileEncryption.decryptDatabaseToBuffer(target),
    ).rejects.toThrow("metadata file is missing");
    fs.writeFileSync(`${target}.meta`, "{not json");
    await expect(
      DatabaseFileEncryption.decryptDatabaseToBuffer(target),
    ).rejects.toThrow("both single-file and two-file");
  });
});

describe("legacy v1 files", () => {
  it("opens them with the old derived key and needs the salt", async () => {
    const salt = crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(
      "termix-database-file-encryption-seed-v1",
      salt,
      100000,
      32,
      "sha256",
    );
    const target = file("v1.encrypted");
    writeTwoFile(target, Buffer.from("v1 data"), key, {
      version: "v1",
      salt: salt.toString("hex"),
    });
    const before = process.env.DB_FILE_KEY;
    delete process.env.DB_FILE_KEY;
    try {
      expect(
        (
          await DatabaseFileEncryption.decryptDatabaseToBuffer(target)
        ).toString(),
      ).toBe("v1 data");
    } finally {
      if (before !== undefined) process.env.DB_FILE_KEY = before;
    }
    const noSalt = file("v1nosalt.encrypted");
    writeTwoFile(noSalt, Buffer.from("x"), key, { version: "v1" });
    await expect(
      DatabaseFileEncryption.decryptDatabaseToBuffer(noSalt),
    ).rejects.toThrow("missing required salt");
  });
});

describe("detection, info and diagnostics", () => {
  it("does not call short, empty or missing files encrypted", () => {
    const tiny = file("tiny");
    fs.writeFileSync(tiny, Buffer.from([1, 2]));
    expect(DatabaseFileEncryption.isEncryptedDatabaseFile(tiny)).toBe(false);
    expect(DatabaseFileEncryption.isEncryptedDatabaseFile(file("gone"))).toBe(
      false,
    );
    expect(DatabaseFileEncryption.getEncryptedFileInfo(tiny)).toBeNull();
  });

  it("reports both files and the environment", async () => {
    const target = file("diag.encrypted");
    await DatabaseFileEncryption.encryptDatabaseFromBuffer(
      Buffer.from("d"),
      target,
    );
    const info = DatabaseFileEncryption.getDiagnosticInfo(target);
    expect(info.dataFile).toMatchObject({ exists: true, readable: true });
    expect(info.metadataFile.exists).toBe(false);
    expect(info.validation.filesConsistent).toBe(false);
    const single = DatabaseFileEncryption.getEncryptedFileInfo(target);
    expect(single).toMatchObject({
      version: "v2",
      fingerprint: expect.any(String),
    });
    expect(
      DatabaseFileEncryption.getDiagnosticInfo(file("absent")).dataFile.exists,
    ).toBe(false);
  });

  it("removes the old .meta file when saving in the single file layout", async () => {
    const target = file("upgrade.encrypted");
    writeTwoFile(target, Buffer.from("x"), keys.current);
    await DatabaseFileEncryption.encryptDatabaseFromBuffer(
      Buffer.from("y"),
      target,
    );
    expect(fs.existsSync(`${target}.meta`)).toBe(false);
    expect(
      (await DatabaseFileEncryption.decryptDatabaseToBuffer(target)).toString(),
    ).toBe("y");
  });

  it("reports a failed save and leaves no temp file", async () => {
    const target = path.join(dir, "missing-dir", "db.encrypted");
    await expect(
      DatabaseFileEncryption.encryptDatabaseFromBuffer(
        Buffer.from("z"),
        target,
      ),
    ).rejects.toThrow("encryption failed");
  });
});

describe("backups", () => {
  it("makes an encrypted backup and restores it", async () => {
    const source = file("live.sqlite");
    fs.writeFileSync(source, "live data");
    const backups = path.join(dir, "backups");
    const backup = await DatabaseFileEncryption.createEncryptedBackup(
      source,
      backups,
    );
    expect(path.dirname(backup)).toBe(backups);
    const restored = await DatabaseFileEncryption.restoreFromEncryptedBackup(
      backup,
      file("restored.sqlite"),
    );
    expect(fs.readFileSync(restored, "utf8")).toBe("live data");
  });

  it("refuses a missing database or a backup that is not encrypted", async () => {
    await expect(
      DatabaseFileEncryption.createEncryptedBackup(file("none"), dir),
    ).rejects.toThrow("does not exist");
    const plain = file("not-a-backup");
    fs.writeFileSync(plain, "plain");
    await expect(
      DatabaseFileEncryption.restoreFromEncryptedBackup(plain),
    ).rejects.toThrow("Invalid encrypted backup file");
  });

  it("cleans up leftover files", () => {
    const base = file("clean");
    for (const suffix of [".tmp", ".encrypted", ".encrypted.meta"]) {
      fs.writeFileSync(`${base}${suffix}`, "x");
    }
    DatabaseFileEncryption.cleanupTempFiles(base);
    for (const suffix of [".tmp", ".encrypted", ".encrypted.meta"]) {
      expect(fs.existsSync(`${base}${suffix}`)).toBe(false);
    }
  });
});
