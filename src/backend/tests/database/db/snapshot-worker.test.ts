import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Worker } from "node:worker_threads";
import Database from "better-sqlite3";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const keyState = vi.hoisted(() => ({
  current: Buffer.alloc(32, 0x42),
}));

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}));

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: loggerMocks,
}));

vi.mock("../../../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({
      getDatabaseKey: async () => keyState.current,
      getPreviousKeys: async () => [],
    }),
  },
}));

const { DatabaseFileEncryption } =
  await import("../../../utils/database-file-encryption.js");
const {
  configureSnapshotWorkerForTest,
  terminateSnapshotWorker,
  writeSnapshotInWorker,
} = await import("../../../database/db/snapshot-worker.js");

let dir: string;
const file = (name: string) => path.join(dir, name);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-snapshot-worker-"));
});

afterAll(async () => {
  await terminateSnapshotWorker();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  keyState.current = Buffer.alloc(32, 0x42);
  loggerMocks.warn.mockClear();
  loggerMocks.error.mockClear();
  configureSnapshotWorkerForTest({
    workerFactory: null,
    idleTimeoutMs: null,
  });
});

afterEach(async () => {
  configureSnapshotWorkerForTest({
    workerFactory: null,
    idleTimeoutMs: null,
  });
  await terminateSnapshotWorker();
  vi.restoreAllMocks();
});

describe("snapshot-worker", () => {
  it("encrypts a standalone ArrayBuffer in worker and round-trips through DatabaseFileEncryption.decryptDatabaseToBuffer", async () => {
    const target = file("encrypted-standalone.sqlite.encrypted");
    const legacyMeta = `${target}.meta`;
    fs.writeFileSync(legacyMeta, JSON.stringify({ legacy: true }));

    // Dedicated ArrayBuffer (byteOffset === 0 && byteLength === buffer.byteLength)
    // exercises the zero-copy transferList path.
    const rawBytes = crypto.randomBytes(256 * 1024);
    const expected = Buffer.from(rawBytes);
    const standalone = Buffer.from(new ArrayBuffer(rawBytes.length));
    rawBytes.copy(standalone);

    await writeSnapshotInWorker({
      targetPath: target,
      buffer: standalone,
      encrypted: true,
      key: keyState.current,
    });

    // Zero-copy transfer detaches the standalone buffer, while keeping the
    // cached key intact on the main thread.
    expect(standalone.byteLength).toBe(0);
    expect(keyState.current.byteLength).toBe(32);

    expect(DatabaseFileEncryption.isEncryptedDatabaseFile(target)).toBe(true);
    expect(DatabaseFileEncryption.getEncryptedFileInfo(target)).toMatchObject({
      version: "v2",
      algorithm: "aes-256-gcm",
      fingerprint: "termix-v2-systemcrypto",
    });
    expect(fs.existsSync(legacyMeta)).toBe(false);

    const decrypted =
      await DatabaseFileEncryption.decryptDatabaseToBuffer(target);
    expect(decrypted.equals(expected)).toBe(true);

    // No lingering temp files left behind.
    const leftovers = fs
      .readdirSync(dir)
      .filter((name) => name.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });

  it("encrypts a real better-sqlite3 serialized external Buffer off-thread without falling back", async () => {
    const target = file("sqlite-external.sqlite.encrypted");
    const sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
    sqlite.prepare("INSERT INTO items (name) VALUES (?)").run("alpha");
    const serialized = sqlite.serialize();
    sqlite.close();

    await writeSnapshotInWorker({
      targetPath: target,
      buffer: serialized,
      encrypted: true,
      key: keyState.current,
    });

    // Must complete inside the worker without triggering main-thread fallback.
    expect(loggerMocks.warn).not.toHaveBeenCalled();

    const decrypted =
      await DatabaseFileEncryption.decryptDatabaseToBuffer(target);
    const reopened = new Database(decrypted);
    const row = reopened.prepare("SELECT name FROM items").get() as {
      name: string;
    };
    reopened.close();
    expect(row.name).toBe("alpha");
  });

  it("safely slices pooled/subarray buffers without detaching sibling bytes", async () => {
    const target = file("encrypted-slice.sqlite.encrypted");
    const slab = Buffer.alloc(1024, 0xaa);
    const payload = Buffer.from("SQLite format 3 slice payload");
    payload.copy(slab, 64);
    const slice = slab.subarray(64, 64 + payload.length);

    await writeSnapshotInWorker({
      targetPath: target,
      buffer: slice,
      encrypted: true,
      key: keyState.current,
    });

    // Sibling slab memory must remain completely intact.
    expect(slab.byteLength).toBe(1024);
    expect(slab[0]).toBe(0xaa);

    const decrypted =
      await DatabaseFileEncryption.decryptDatabaseToBuffer(target);
    expect(decrypted.equals(payload)).toBe(true);
  });

  it("atomically writes and replaces plaintext snapshots in the worker", async () => {
    const target = file("plain.sqlite");
    fs.writeFileSync(target, "previous-version");

    const updated = Buffer.from("SQLite format 3 fresh contents");
    await writeSnapshotInWorker({
      targetPath: target,
      buffer: updated,
      encrypted: false,
    });

    expect(fs.readFileSync(target)).toEqual(
      Buffer.from("SQLite format 3 fresh contents"),
    );

    const leftovers = fs
      .readdirSync(dir)
      .filter((name) => name.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });

  it("falls back to main-thread encryption when worker construction fails", async () => {
    const target = file("fallback-encrypted.sqlite.encrypted");
    configureSnapshotWorkerForTest({
      workerFactory: () => {
        throw new Error("worker threads unavailable");
      },
    });

    const payload = Buffer.from("main-thread encrypted fallback payload");
    await writeSnapshotInWorker({
      targetPath: target,
      buffer: payload,
      encrypted: true,
      key: keyState.current,
    });

    const decrypted =
      await DatabaseFileEncryption.decryptDatabaseToBuffer(target);
    expect(decrypted.equals(payload)).toBe(true);
  });

  it("falls back to main-thread atomic write when worker construction fails in plaintext mode", async () => {
    const target = file("fallback-plain.sqlite");
    fs.writeFileSync(target, "old-plain");
    configureSnapshotWorkerForTest({
      workerFactory: () => {
        throw new Error("worker threads disabled");
      },
    });

    const payload = Buffer.from("new-plain-via-fallback");
    await writeSnapshotInWorker({
      targetPath: target,
      buffer: payload,
      encrypted: false,
    });

    expect(fs.readFileSync(target, "utf8")).toBe("new-plain-via-fallback");
  });

  it("falls back using reserialize when worker crashes mid-flight after transfer", async () => {
    const target = file("fallback-crash.sqlite.encrypted");
    const raw = Buffer.from("survives-worker-crash");
    const standalone = Buffer.from(new ArrayBuffer(raw.length));
    raw.copy(standalone);

    configureSnapshotWorkerForTest({
      workerFactory: () => {
        const fake = new EventEmitter() as unknown as Worker;
        fake.ref = vi.fn();
        fake.unref = vi.fn();
        fake.terminate = vi.fn().mockResolvedValue(0);
        fake.postMessage = vi.fn(() => {
          // Simulate the worker crashing right after receiving the transferred buffer.
          queueMicrotask(() => {
            fake.emit("error", new Error("worker crashed"));
          });
        });
        return fake;
      },
    });

    await writeSnapshotInWorker({
      targetPath: target,
      buffer: standalone,
      encrypted: true,
      key: keyState.current,
      reserialize: () => Buffer.from(raw),
    });

    const decrypted =
      await DatabaseFileEncryption.decryptDatabaseToBuffer(target);
    expect(decrypted.equals(raw)).toBe(true);
  });

  it("propagates filesystem write errors from the worker without swallowing them", async () => {
    const missingDirTarget = path.join(
      dir,
      "does-not-exist-subdir",
      "db.sqlite",
    );

    await expect(
      writeSnapshotInWorker({
        targetPath: missingDirTarget,
        buffer: Buffer.from("will-fail"),
        encrypted: false,
      }),
    ).rejects.toThrow();
  });

  it("auto-terminates after idle timeout and allows subsequent saves to respawn", async () => {
    configureSnapshotWorkerForTest({ idleTimeoutMs: 50 });

    const first = file("idle-1.sqlite");
    const second = file("idle-2.sqlite");

    await writeSnapshotInWorker({
      targetPath: first,
      buffer: Buffer.from("first-save"),
      encrypted: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 120));

    await writeSnapshotInWorker({
      targetPath: second,
      buffer: Buffer.from("second-save"),
      encrypted: false,
    });

    expect(fs.readFileSync(first, "utf8")).toBe("first-save");
    expect(fs.readFileSync(second, "utf8")).toBe("second-save");
  });
});
