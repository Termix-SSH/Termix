import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import {
  exceedsImageStorageLimit,
  isExpiredImage,
  isImageFilename,
} from "./terminal-image-utils.js";
import type { TerminalImageStorageSettings } from "./terminal-image-storage-settings.js";

/**
 * Stable error codes for image storage failures. These are part of the upload
 * route's contract; `IMAGE_REMOTE_WRITE_FAILED` predates this module and must
 * not change.
 */
export type TerminalImageStorageErrorCode =
  | "IMAGE_STORAGE_LIMIT_REACHED"
  | "IMAGE_LOCAL_WRITE_FAILED"
  | "IMAGE_LOCAL_INSPECTION_FAILED"
  | "IMAGE_REMOTE_QUOTA_UNAVAILABLE"
  | "IMAGE_REMOTE_WRITE_FAILED";

export class TerminalImageStorageError extends Error {
  constructor(
    readonly code: TerminalImageStorageErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TerminalImageStorageError";
  }
}

export interface StoredTerminalImage {
  id: string;
  filename: string;
  /** Agent-visible path; never a backend-internal path. */
  shellPath: string;
  storage: "local" | "remote-sftp";
}

/**
 * Mode selection for one upload. Explicit modes are deterministic — they are
 * returned regardless of capability and the route reports the failure; only
 * `auto` falls back, and only on capability (a connected terminal session
 * with SFTP), never on configuration.
 */
export function selectImageStorageMode(
  settings: Pick<TerminalImageStorageSettings, "mode" | "localMappingConfigured">,
  capability: { remoteSftpAvailable: boolean; localHostVisible?: boolean },
): "local" | "remote-sftp" | "unavailable" {
  if (settings.mode === "local") return "local";
  if (settings.mode === "remote-sftp") return "remote-sftp";
  if (settings.localMappingConfigured && capability.localHostVisible === true) {
    return "local";
  }
  return capability.remoteSftpAvailable ? "remote-sftp" : "unavailable";
}

// Capacity checks and writes are serialized so concurrent uploads cannot
// bypass the count or byte limits.
let imageStorageQueue: Promise<unknown> = Promise.resolve();

function withImageStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = imageStorageQueue.then(operation, operation);
  imageStorageQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function cleanupExpiredImages(
  localDir: string,
  ttlMs: number,
): Promise<void> {
  const entries = await fs.readdir(localDir, { withFileTypes: true });
  const now = Date.now();
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isImageFilename(entry.name))
      .map(async (entry) => {
        const filePath = path.join(localDir, entry.name);
        const stat = await fs.stat(filePath);
        if (stat && isExpiredImage(stat.mtimeMs, now, ttlMs)) {
          await fs.unlink(filePath).catch(() => undefined);
        }
      }),
  );
}

async function getActiveImageStorageUsage(
  localDir: string,
  ttlMs: number,
): Promise<{ fileCount: number; totalBytes: number }> {
  const entries = await fs.readdir(localDir, { withFileTypes: true });
  const now = Date.now();
  const stats = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isImageFilename(entry.name))
      .map(async (entry) => {
        const stat = await fs.stat(path.join(localDir, entry.name));
        return !isExpiredImage(stat.mtimeMs, now, ttlMs) ? stat : null;
      }),
  );

  return stats.reduce(
    (usage, stat) => {
      if (stat) {
        usage.fileCount += 1;
        usage.totalBytes += stat.size;
      }
      return usage;
    },
    { fileCount: 0, totalBytes: 0 },
  );
}

/**
 * Local mapped-storage adapter. Enforces the TTL/count/byte policy and raises
 * `IMAGE_STORAGE_LIMIT_REACHED` (HTTP 507 at the route) when the caps are hit.
 * The returned shellPath is built from the agent-visible hostPath — the
 * backend's own localDir is never exposed.
 */
export async function storeImageLocally(
  image: Buffer,
  settings: TerminalImageStorageSettings,
): Promise<StoredTerminalImage> {
  return withImageStorageLock(async () => {
    let usage: { fileCount: number; totalBytes: number };
    try {
      await cleanupExpiredImages(settings.localDir, settings.ttlMs);
      usage = await getActiveImageStorageUsage(
        settings.localDir,
        settings.ttlMs,
      );
    } catch (error) {
      throw new TerminalImageStorageError(
        "IMAGE_LOCAL_INSPECTION_FAILED",
        "Unable to inspect local image storage",
        error,
      );
    }
    if (
      exceedsImageStorageLimit(
        usage.fileCount,
        usage.totalBytes,
        image.length,
        settings.maxCount,
        settings.maxBytes,
      )
    ) {
      throw new TerminalImageStorageError(
        "IMAGE_STORAGE_LIMIT_REACHED",
        "Image storage limit reached",
      );
    }

    const id = randomUUID();
    const filename = `${id}.png`;
    try {
      await fs.mkdir(settings.localDir, { recursive: true });
      await fs.writeFile(path.join(settings.localDir, filename), image);
    } catch (error) {
      throw new TerminalImageStorageError(
        "IMAGE_LOCAL_WRITE_FAILED",
        "Failed to write image to local storage",
        error,
      );
    }

    return {
      id,
      filename,
      shellPath: path.posix.join(settings.hostPath, filename),
      storage: "local",
    };
  });
}

// Remote directory (on the SSH host the terminal is connected to) that
// uploaded/pasted images are written into. Always POSIX-style: this is a
// path on the remote shell, not on the Termix backend's own filesystem.
export const REMOTE_IMAGE_DIR = "/tmp/termix-images";

/** Minimal SFTP surface the remote adapter needs (satisfied by ssh2). */
export interface ImageSftpClient {
  mkdir(
    dir: string,
    attrsOrCallback: { mode?: number } | ((err?: Error) => void),
    callback?: (err?: Error) => void,
  ): void;
  createWriteStream(
    remotePath: string,
    options?: { mode?: number },
  ): NodeJS.WritableStream;
  stat?: (
    dir: string,
    callback: (error: Error | undefined, attrs?: { mode?: number }) => void,
  ) => void;
  lstat?: (
    dir: string,
    callback: (error: Error | undefined, attrs?: { mode?: number }) => void,
  ) => void;
  chmod?: (dir: string, mode: number, callback: (error?: Error) => void) => void;
  readdir?: (
    dir: string,
    callback: (error: Error | undefined, entries: ImageSftpEntry[]) => void,
  ) => void;
  unlink?: (remotePath: string, callback: (error?: Error) => void) => void;
  end?: () => void;
}

interface ImageSftpEntry {
  filename: string;
  attrs?: { mtime?: number; size?: number };
}

export interface ImageSshExecClient {
  exec(
    command: string,
    callback: (error: Error | undefined, stream?: ImageExecStream) => void,
  ): void;
}

interface ImageExecStream {
  on(event: "close", listener: (code: number | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  resume(): void;
}

function quoteRemotePath(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function execBounded(
  sshConn: ImageSshExecClient,
  command: string,
  timeoutMs = 3_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    sshConn.exec(command, (error, stream) => {
      if (error || !stream) {
        clearTimeout(timer);
        finish(false);
        return;
      }
      stream.on("close", (code) => {
        clearTimeout(timer);
        finish(code === 0);
      });
      stream.on("error", () => {
        clearTimeout(timer);
        finish(false);
      });
      stream.resume();
    });
  });
}

/** Verify a configured local mapping from the currently connected SSH session. */
export async function probeLocalImageVisibility(
  sshConn: ImageSshExecClient,
  settings: Pick<TerminalImageStorageSettings, "localDir" | "hostPath">,
): Promise<boolean> {
  const filename = `.termix-image-probe-${randomUUID()}`;
  const localProbe = path.join(settings.localDir, filename);
  const remoteProbe = path.posix.join(settings.hostPath, filename);
  await fs.mkdir(settings.localDir, { recursive: true });
  await fs.writeFile(localProbe, "termix-image-probe", { flag: "wx" });
  try {
    return await execBounded(
      sshConn,
      `test -f -- ${quoteRemotePath(remoteProbe)}`,
    );
  } finally {
    await fs.unlink(localProbe).catch(() => undefined);
    await execBounded(sshConn, `rm -f -- ${quoteRemotePath(remoteProbe)}`);
  }
}

function sftpMkdir(sftp: ImageSftpClient, dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(dir, { mode: 0o700 }, (err) => {
      if (!err) {
        resolve();
        return;
      }
      if (/exist/i.test(err.message)) {
        resolve();
        return;
      }
      const inspect = sftp.lstat ?? sftp.stat;
      if (!inspect) {
        reject(err);
        return;
      }
      inspect(dir, (inspectError, attrs) => {
        if (inspectError || !attrs) {
          reject(inspectError ?? err);
          return;
        }
        if (attrs.mode !== undefined && (attrs.mode & 0o170000) !== 0o040000) {
          reject(new Error("Remote image path is not a directory"));
          return;
        }
        if (!sftp.chmod) {
          reject(new Error("Remote image directory permissions cannot be verified"));
          return;
        }
        sftp.chmod(dir, 0o700, (chmodError) => {
          if (chmodError) reject(chmodError);
          else resolve();
        });
      });
    });
  });
}

function sftpWriteFile(
  sftp: ImageSftpClient,
  remotePath: string,
  data: Buffer,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath, { mode: 0o600 }) as NodeJS.WritableStream & {
      destroy?: () => void;
    };
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stream.destroy?.();
      reject(new Error("SFTP image write timed out"));
    }, timeoutMs);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    stream.on("error", (error: Error) => finish(error));
    stream.on("close", () => finish());
    stream.end(data);
  });
}

async function cleanupExpiredRemoteImages(
  sftp: ImageSftpClient,
  ttlMs: number | undefined,
  nowMs = Date.now(),
): Promise<void> {
  if (!ttlMs || ttlMs <= 0 || !sftp.readdir || !sftp.unlink) return;
  const entries = await new Promise<ImageSftpEntry[]>((resolve) => {
    sftp.readdir!(REMOTE_IMAGE_DIR, (error, result) => {
      resolve(error ? [] : result);
    });
  });
  const cutoffSeconds = (nowMs - ttlMs) / 1000;
  const uuidPng = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i;
  await Promise.all(
    entries
      .filter(
        (entry) =>
          uuidPng.test(entry.filename) &&
          typeof entry.attrs?.mtime === "number" &&
          entry.attrs.mtime < cutoffSeconds,
      )
      .map(
        (entry) =>
          new Promise<void>((resolve) => {
            sftp.unlink!(
              `${REMOTE_IMAGE_DIR}/${entry.filename}`,
              () => resolve(),
            );
          }),
      ),
  );
}

const REMOTE_UUID_PNG_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i;

async function enforceRemoteImageLimits(
  sftp: ImageSftpClient,
  imageBytes: number,
  maxCount: number,
  maxBytes: number,
): Promise<void> {
  if (!sftp.readdir) {
    throw new TerminalImageStorageError(
      "IMAGE_REMOTE_QUOTA_UNAVAILABLE",
      "Remote image storage limits cannot be verified",
    );
  }
  let entries: ImageSftpEntry[];
  try {
    entries = await new Promise<ImageSftpEntry[]>((resolve, reject) => {
      sftp.readdir!(REMOTE_IMAGE_DIR, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
  } catch (error) {
    throw new TerminalImageStorageError(
      "IMAGE_REMOTE_QUOTA_UNAVAILABLE",
      "Remote image storage limits cannot be verified",
      error,
    );
  }
  const images = entries.filter((entry) => REMOTE_UUID_PNG_PATTERN.test(entry.filename));
  const totalBytes = images.reduce((sum, entry) => {
    if (typeof entry.attrs?.size !== "number") {
      throw new TerminalImageStorageError(
        "IMAGE_REMOTE_QUOTA_UNAVAILABLE",
        "Remote image storage limits cannot be verified",
      );
    }
    return sum + entry.attrs.size;
  }, 0);
  if (images.length >= maxCount || totalBytes + imageBytes > maxBytes) {
    throw new TerminalImageStorageError(
      "IMAGE_STORAGE_LIMIT_REACHED",
      "Image storage limit reached",
    );
  }
}
export async function storeImageViaSftp(
  sftp: ImageSftpClient,
  image: Buffer,
  options: {
    writeTimeoutMs?: number;
    ttlMs?: number;
    maxCount?: number;
    maxBytes?: number;
    nowMs?: number;
  } = {},
): Promise<StoredTerminalImage> {
  const id = randomUUID();
  const filename = `${id}.png`;
  const remotePath = `${REMOTE_IMAGE_DIR}/${filename}`;

  try {
    await cleanupExpiredRemoteImages(sftp, options.ttlMs, options.nowMs);
    await sftpMkdir(sftp, REMOTE_IMAGE_DIR);
    if (options.maxCount !== undefined || options.maxBytes !== undefined) {
      await enforceRemoteImageLimits(
        sftp,
        image.length,
        options.maxCount ?? 100,
        options.maxBytes ?? 5_368_709_120,
      );
    }
    await sftpWriteFile(
      sftp,
      remotePath,
      image,
      options.writeTimeoutMs,
    );
  } catch (error) {
    if (error instanceof TerminalImageStorageError) throw error;
    throw new TerminalImageStorageError(
      "IMAGE_REMOTE_WRITE_FAILED",
      "Failed to write image to the remote host",
      error,
    );
  }

  return { id, filename, shellPath: remotePath, storage: "remote-sftp" };
}
