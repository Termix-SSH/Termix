/**
 * Offloads SQLite snapshot encryption and atomic disk writes to a dedicated
 * Node.js worker thread so large database saves do not block the main event
 * loop. Falls back transparently to the main-thread implementation whenever
 * the worker cannot start or fails unexpectedly.
 */

import { Worker } from "node:worker_threads";
import { DatabaseFileEncryption } from "../../utils/database-file-encryption.js";
import { getErrorMessage } from "../../utils/error-message.js";
import { databaseLogger } from "../../utils/logger.js";
import { SystemCrypto } from "../../utils/system-crypto.js";
import { writeFileAtomic } from "./snapshot-save.js";

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

export interface WriteSnapshotOptions {
  targetPath: string;
  buffer: Buffer;
  encrypted: boolean;
  key?: Buffer;
  /**
   * Optional fallback serializer invoked only when a zero-copy transferred
   * ArrayBuffer is lost because the worker crashed mid-flight.
   */
  reserialize?: () => Buffer;
}

interface WorkerRequest {
  id: number;
  targetPath: string;
  encrypted: boolean;
  data: ArrayBuffer;
  key?: Uint8Array;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  error?: string;
  code?: string;
}

interface PendingJob {
  resolve: () => void;
  reject: (error: Error) => void;
}

type WorkerFactory = (script: string) => Worker;

class WorkerTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WorkerTransportError";
  }
}

/**
 * Pure CommonJS inline worker script. Running with `{ eval: true }` avoids
 * file-path resolution issues across Vitest TS sources, compiled `dist/`,
 * Electron asar archives, and Docker builds.
 *
 * The encrypted single-file layout matches `DatabaseFileEncryption.encryptDatabaseFromBuffer`
 * byte-for-byte:
 *   [4-byte UInt32BE metadataLength][UTF-8 JSON metadata][AES-256-GCM ciphertext]
 */
const WORKER_SCRIPT = `"use strict";
const { parentPort } = require("node:worker_threads");
const fs = require("node:fs");
const crypto = require("node:crypto");

const VERSION = "v2";
const ALGORITHM = "aes-256-gcm";
const METADATA_FILE_SUFFIX = ".meta";
const LOCK_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

async function renameWithRetry(from, to, attempts = 10, delayMs = 100) {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (error) {
      const code = error && typeof error === "object" ? error.code : undefined;
      if (attempt >= attempts || !code || !LOCK_CODES.has(code)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}

async function writeAllAndSync(filePath, buffers) {
  const handle = await fs.promises.open(filePath, "w");
  try {
    for (const chunk of buffers) {
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await handle.write(
          chunk,
          offset,
          chunk.length - offset,
        );
        if (bytesWritten === 0) {
          throw new Error("Short write while persisting database snapshot");
        }
        offset += bytesWritten;
      }
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function handleJob(msg) {
  const { id, targetPath, encrypted, data, key } = msg;
  const plainBuf = Buffer.from(data);
  const tmpPath =
    targetPath +
    ".tmp-" +
    Date.now() +
    "-" +
    process.pid +
    "-" +
    crypto.randomBytes(4).toString("hex");

  try {
    if (encrypted) {
      const keyBuf = Buffer.from(key);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(ALGORITHM, keyBuf, iv);
      const part1 = cipher.update(plainBuf);
      const part2 = cipher.final();
      const tag = cipher.getAuthTag();
      const encryptedLength = part1.length + part2.length;

      const metadata = {
        iv: iv.toString("hex"),
        tag: tag.toString("hex"),
        version: VERSION,
        fingerprint: "termix-v2-systemcrypto",
        algorithm: ALGORITHM,
        keySource: "SystemCrypto",
        dataSize: encryptedLength,
      };

      const metadataBuffer = Buffer.from(JSON.stringify(metadata, null, 2), "utf8");
      const metadataLengthBuffer = Buffer.alloc(4);
      metadataLengthBuffer.writeUInt32BE(metadataBuffer.length, 0);

      await writeAllAndSync(tmpPath, [
        metadataLengthBuffer,
        metadataBuffer,
        part1,
        part2,
      ]);
      await renameWithRetry(tmpPath, targetPath);

      const metadataPath = targetPath + METADATA_FILE_SUFFIX;
      await fs.promises.unlink(metadataPath).catch(() => {});
    } else {
      await writeAllAndSync(tmpPath, [plainBuf]);
      await renameWithRetry(tmpPath, targetPath);
    }

    parentPort.postMessage({ id, ok: true });
  } catch (error) {
    await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
    parentPort.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: error && typeof error === "object" ? error.code : undefined,
    });
  }
}

let queue = Promise.resolve();
parentPort.on("message", (msg) => {
  queue = queue.then(() => handleJob(msg));
});
`;

let activeWorker: Worker | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let nextJobId = 1;
const pendingJobs = new Map<number, PendingJob>();

let idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS;
const defaultWorkerFactory: WorkerFactory = (script) =>
  new Worker(script, { eval: true });
let workerFactory: WorkerFactory = defaultWorkerFactory;

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleShutdown(): void {
  clearIdleTimer();
  if (!activeWorker || pendingJobs.size > 0) return;
  activeWorker.unref();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (pendingJobs.size === 0) {
      void terminateSnapshotWorker();
    }
  }, idleTimeoutMs);
  idleTimer.unref();
}

function rejectAllPending(error: Error): void {
  for (const [id, job] of pendingJobs.entries()) {
    pendingJobs.delete(id);
    job.reject(error);
  }
}

function detachWorker(target: Worker, reason: Error): void {
  if (activeWorker === target) {
    activeWorker = null;
  }
  clearIdleTimer();
  rejectAllPending(reason);
}

function ensureWorker(): Worker {
  if (activeWorker) return activeWorker;

  let created: Worker;
  try {
    created = workerFactory(WORKER_SCRIPT);
  } catch (error) {
    throw new WorkerTransportError(
      `Failed to start snapshot worker: ${getErrorMessage(error)}`,
      { cause: error },
    );
  }

  created.on("message", (response: WorkerResponse) => {
    const job = pendingJobs.get(response.id);
    if (!job) return;
    pendingJobs.delete(response.id);

    if (response.ok) {
      job.resolve();
    } else {
      const err = new Error(
        response.error || "Snapshot worker write failed",
      ) as NodeJS.ErrnoException;
      if (response.code) err.code = response.code;
      job.reject(err);
    }

    if (pendingJobs.size === 0) {
      scheduleIdleShutdown();
    }
  });

  created.on("error", (error) => {
    detachWorker(
      created,
      new WorkerTransportError(
        `Snapshot worker error: ${getErrorMessage(error)}`,
        { cause: error },
      ),
    );
  });

  created.on("exit", (code) => {
    if (activeWorker === created) {
      detachWorker(
        created,
        new WorkerTransportError(
          `Snapshot worker exited unexpectedly (code ${code})`,
        ),
      );
    }
  });

  activeWorker = created;
  return created;
}

function copyToTransferableArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

/**
 * Extracts a standalone ArrayBuffer suitable for zero-copy transfer.
 * Buffers sliced out of Node's shared slab pool are copied into a dedicated
 * ArrayBuffer so unrelated allocations in the same pool are never detached.
 */
function toTransferableArrayBuffer(buffer: Buffer): {
  arrayBuffer: ArrayBuffer;
  copied: boolean;
} {
  if (
    buffer.buffer instanceof ArrayBuffer &&
    buffer.byteOffset === 0 &&
    buffer.byteLength === buffer.buffer.byteLength
  ) {
    return { arrayBuffer: buffer.buffer, copied: false };
  }
  return {
    arrayBuffer: copyToTransferableArrayBuffer(buffer),
    copied: true,
  };
}

function isNonTransferableArrayBufferError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  const message = (error as { message?: unknown }).message;
  return (
    name === "DataCloneError" ||
    (typeof message === "string" && message.includes("Cannot transfer"))
  );
}

function runInWorker(options: {
  targetPath: string;
  buffer: Buffer;
  encrypted: boolean;
  key?: Buffer;
}): Promise<void> {
  const worker = ensureWorker();
  clearIdleTimer();
  worker.ref();

  const id = nextJobId++;
  const { arrayBuffer: initialData, copied } = toTransferableArrayBuffer(
    options.buffer,
  );
  // Copy the 32-byte key rather than transferring it so SystemCrypto's cached
  // key Buffer on the main thread is never detached.
  const keyCopy =
    options.encrypted && options.key ? new Uint8Array(options.key) : undefined;

  return new Promise<void>((resolve, reject) => {
    pendingJobs.set(id, { resolve, reject });
    try {
      const request: WorkerRequest = {
        id,
        targetPath: options.targetPath,
        encrypted: options.encrypted,
        data: initialData,
        key: keyCopy,
      };
      try {
        worker.postMessage(request, [initialData]);
      } catch (postError) {
        if (!copied && isNonTransferableArrayBufferError(postError)) {
          // Native addons such as better-sqlite3 return external ArrayBuffers
          // that V8 refuses to detach. Copy once into a V8-owned ArrayBuffer
          // so the worker still handles encryption and disk I/O off-thread.
          const ownedData = copyToTransferableArrayBuffer(options.buffer);
          worker.postMessage({ ...request, data: ownedData }, [ownedData]);
        } else {
          throw postError;
        }
      }
    } catch (error) {
      pendingJobs.delete(id);
      if (pendingJobs.size === 0) {
        scheduleIdleShutdown();
      }
      reject(
        new WorkerTransportError(
          `Failed to post snapshot job to worker: ${getErrorMessage(error)}`,
          { cause: error },
        ),
      );
    }
  });
}

async function writeOnMainThread(
  targetPath: string,
  buffer: Buffer,
  encrypted: boolean,
): Promise<void> {
  if (encrypted) {
    await DatabaseFileEncryption.encryptDatabaseFromBuffer(buffer, targetPath);
  } else {
    await writeFileAtomic(targetPath, buffer);
  }
}

/**
 * Persists a serialized SQLite buffer via the background worker thread,
 * falling back to the main thread if the worker cannot start or crashes.
 */
export async function writeSnapshotInWorker(
  options: WriteSnapshotOptions,
): Promise<void> {
  const { targetPath, buffer, encrypted, reserialize } = options;
  const originalLength = buffer.byteLength;
  const key = encrypted
    ? (options.key ?? (await SystemCrypto.getInstance().getDatabaseKey()))
    : undefined;

  try {
    await runInWorker({
      targetPath,
      buffer,
      encrypted,
      key,
    });
  } catch (error) {
    if (!(error instanceof WorkerTransportError)) {
      throw error;
    }

    databaseLogger.warn(
      "Snapshot worker unavailable, falling back to main-thread write",
      {
        operation: "snapshot_worker_fallback",
        targetPath,
        encrypted,
        error: getErrorMessage(error),
      },
    );

    const stillIntact =
      originalLength === 0 || buffer.byteLength === originalLength;
    let fallbackBuffer: Buffer;
    if (stillIntact) {
      fallbackBuffer = buffer;
    } else if (reserialize) {
      fallbackBuffer = reserialize();
    } else {
      throw error;
    }

    await writeOnMainThread(targetPath, fallbackBuffer, encrypted);
  }
}

/** Terminates the idle or active snapshot worker. Safe to call repeatedly. */
export async function terminateSnapshotWorker(): Promise<void> {
  clearIdleTimer();
  const current = activeWorker;
  activeWorker = null;
  rejectAllPending(new WorkerTransportError("Snapshot worker terminated"));
  if (current) {
    await current.terminate();
  }
}

/** Test-only hooks for exercising fallback and idle-timeout behavior. */
export function configureSnapshotWorkerForTest(options: {
  workerFactory?: WorkerFactory | null;
  idleTimeoutMs?: number | null;
}): void {
  if (options.workerFactory !== undefined) {
    workerFactory = options.workerFactory ?? defaultWorkerFactory;
  }
  if (options.idleTimeoutMs !== undefined) {
    idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }
}
