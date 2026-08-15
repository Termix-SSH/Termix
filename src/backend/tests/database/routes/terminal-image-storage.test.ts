import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventEmitter } from "events";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import {
  REMOTE_IMAGE_DIR,
  selectImageStorageMode,
  storeImageLocally,
  storeImageViaSftp,
  TerminalImageStorageError,
  type ImageSftpClient,
} from "../../../database/routes/terminal-image-storage.js";
import type { TerminalImageStorageSettings } from "../../../database/routes/terminal-image-storage-settings.js";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function settings(
  overrides: Partial<TerminalImageStorageSettings>,
): TerminalImageStorageSettings {
  return {
    mode: "local",
    localDir: "/nonexistent",
    hostPath: "/tmp/termix-image-v0",
    ttlMs: 3_600_000,
    maxCount: 100,
    maxBytes: 5_368_709_120,
    localMappingConfigured: false,
    ...overrides,
  };
}

describe("selectImageStorageMode", () => {
  it("keeps explicit modes deterministic regardless of capability", () => {
    expect(
      selectImageStorageMode(
        settings({ mode: "local" }),
        { remoteSftpAvailable: true },
      ),
    ).toBe("local");
    expect(
      selectImageStorageMode(
        settings({ mode: "remote-sftp" }),
        { remoteSftpAvailable: false },
      ),
    ).toBe("remote-sftp");
  });

  it("falls back on capability only in auto mode", () => {
    expect(
      selectImageStorageMode(settings({ mode: "auto" }), {
        remoteSftpAvailable: true,
      }),
    ).toBe("remote-sftp");
    expect(
      selectImageStorageMode(settings({ mode: "auto" }), {
        remoteSftpAvailable: false,
      }),
    ).toBe("unavailable");
    expect(
      selectImageStorageMode(
        settings({ mode: "auto", localMappingConfigured: true }),
        { remoteSftpAvailable: false, localHostVisible: true },
      ),
    ).toBe("local");
  });
});

describe("storeImageLocally", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "termix-images-test-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function seedFile(bytes: number, mtimeMs?: number): Promise<string> {
    const name = `${randomUUID()}.png`;
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, Buffer.alloc(bytes));
    if (mtimeMs !== undefined) {
      const date = new Date(mtimeMs);
      await fs.utimes(filePath, date, date);
    }
    return name;
  }

  it("writes a UUID-named PNG and returns the agent-visible host path", async () => {
    const stored = await storeImageLocally(
      PNG_BYTES,
      settings({ localDir: dir, hostPath: "/host-view/images" }),
    );

    expect(stored.storage).toBe("local");
    expect(stored.filename).toBe(`${stored.id}.png`);
    expect(stored.shellPath).toBe(
      path.posix.join("/host-view/images", stored.filename),
    );
    expect(stored.shellPath).not.toContain(dir);
    await expect(
      fs.readFile(path.join(dir, stored.filename)),
    ).resolves.toEqual(PNG_BYTES);
  });

  it("rejects with IMAGE_STORAGE_LIMIT_REACHED when the count cap is full", async () => {
    await seedFile(10);
    const error = await storeImageLocally(
      PNG_BYTES,
      settings({ localDir: dir, maxCount: 1 }),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TerminalImageStorageError);
    expect((error as TerminalImageStorageError).code).toBe(
      "IMAGE_STORAGE_LIMIT_REACHED",
    );
  });

  it("rejects with IMAGE_STORAGE_LIMIT_REACHED when the byte cap is full", async () => {
    await seedFile(900);
    const error = await storeImageLocally(
      Buffer.alloc(200),
      settings({ localDir: dir, maxBytes: 1_000 }),
    ).catch((caught: unknown) => caught);

    expect((error as TerminalImageStorageError).code).toBe(
      "IMAGE_STORAGE_LIMIT_REACHED",
    );
  });

  it("cleans expired files during upload so they no longer count", async () => {
    await seedFile(10, Date.now() - 2 * 3_600_000);
    const stored = await storeImageLocally(
      PNG_BYTES,
      settings({ localDir: dir, maxCount: 1, ttlMs: 3_600_000 }),
    );

    expect(stored.storage).toBe("local");
    const remaining = await fs.readdir(dir);
    expect(remaining).toEqual([stored.filename]);
  });

  it("fails closed when local storage inspection is unavailable", async () => {
    const blocked = path.join(dir, "blocked-file");
    await fs.writeFile(blocked, "not a directory");

    const error = await storeImageLocally(
      PNG_BYTES,
      settings({ localDir: blocked }),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TerminalImageStorageError);
    expect((error as TerminalImageStorageError).code).toBe(
      "IMAGE_LOCAL_INSPECTION_FAILED",
    );
  });
  it("reports inspection failures before attempting a write", async () => {
    const blocked = path.join(dir, "blocked");
    await fs.writeFile(blocked, "not a directory");

    const error = await storeImageLocally(
      PNG_BYTES,
      settings({ localDir: path.join(blocked, "images") }),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TerminalImageStorageError);
    expect((error as TerminalImageStorageError).code).toBe(
      "IMAGE_LOCAL_INSPECTION_FAILED",
    );
  });
});

describe("storeImageViaSftp", () => {
  function fakeSftp(behavior: {
    mkdirError?: Error;
    writeError?: Error;
    stallWrite?: boolean;
    readdirEntries?: Array<{ filename: string; mtime?: number; size?: number }>;
    readdirError?: Error;
    statMode?: number;
  }): {
    sftp: ImageSftpClient;
    written: Map<string, Buffer>;
    calls: {
      mkdir: Array<{ dir: string; mode?: number }>;
      createWriteStream: Array<{ path: string; mode?: number }>;
    };
    streams: Array<NodeJS.WritableStream & { destroy: () => void; destroyed: boolean }>;
  } {
    const written = new Map<string, Buffer>();
    const streams: Array<NodeJS.WritableStream & { destroy: () => void; destroyed: boolean }> = [];
    const calls = { mkdir: [], createWriteStream: [] } as {
      mkdir: Array<{ dir: string; mode?: number }>;
      createWriteStream: Array<{ path: string; mode?: number }>;
    };
    const sftp = {
      mkdir: (
        dir: string,
        attrsOrCallback: { mode?: number } | ((err?: Error) => void),
        maybeCallback?: (err?: Error) => void,
      ) => {
        const callback =
          typeof attrsOrCallback === "function"
            ? attrsOrCallback
            : maybeCallback!;
        calls.mkdir.push({
          dir,
          mode:
            typeof attrsOrCallback === "function"
              ? undefined
              : attrsOrCallback.mode,
        });
        callback(dir === REMOTE_IMAGE_DIR ? behavior.mkdirError : undefined);
      },
      stat: (
        _dir: string,
        callback: (error: Error | undefined, attrs?: { mode?: number }) => void,
      ) => callback(undefined, { mode: behavior.statMode ?? 0o40700 }),
      chmod: (
        _dir: string,
        _mode: number,
        callback: (error?: Error) => void,
      ) => callback(),
      readdir: (
        _dir: string,
        callback: (error: Error | undefined, entries: Array<{ filename: string; attrs?: { mtime?: number; size?: number } }>) => void,
      ) => callback(behavior.readdirError, behavior.readdirEntries?.map((entry) => ({ filename: entry.filename, attrs: entry })) ?? []),
      createWriteStream: (
        remotePath: string,
        options?: { mode?: number },
      ) => {
        calls.createWriteStream.push({ path: remotePath, mode: options?.mode });
        const stream = new EventEmitter() as NodeJS.WritableStream & {
          end: (data: Buffer) => void;
          destroy: () => void;
          destroyed: boolean;
        };
        stream.destroyed = false;
        stream.destroy = () => {
          stream.destroyed = true;
        };
        streams.push(stream);
        stream.end = (data: Buffer) => {
          if (behavior.stallWrite) return;
          queueMicrotask(() => {
            if (behavior.writeError) {
              stream.emit("error", behavior.writeError);
              return;
            }
            written.set(remotePath, data);
            stream.emit("close");
          });
        };
        return stream;
      },
      unlink: (
        _remotePath: string,
        callback: (error?: Error) => void,
      ) => callback(),
      rmdir: (
        _dir: string,
        callback: (error?: Error) => void,
      ) => callback(),
    } as unknown as ImageSftpClient;
    return { sftp, written, calls, streams };
  }

  it("writes into the remote image directory and returns its POSIX path", async () => {
    const { sftp, written } = fakeSftp({});
    const stored = await storeImageViaSftp(sftp, PNG_BYTES);

    expect(stored.storage).toBe("remote-sftp");
    expect(stored.shellPath).toBe(
      `${REMOTE_IMAGE_DIR}/${stored.id}.png`,
    );
    expect(written.get(stored.shellPath)).toEqual(PNG_BYTES);
  });

  it("requests restrictive modes for the remote directory and file", async () => {
    const { sftp, calls } = fakeSftp({});
    const stored = await storeImageViaSftp(sftp, PNG_BYTES);

    expect(stored.storage).toBe("remote-sftp");
    expect(calls.mkdir).toEqual([
      { dir: REMOTE_IMAGE_DIR, mode: 0o700 },
      { dir: `${REMOTE_IMAGE_DIR}/.termix-write-lock`, mode: 0o700 },
    ]);
    expect(calls.createWriteStream).toEqual([
      { path: stored.shellPath, mode: 0o600 },
    ]);
  });
  it("removes expired UUID PNGs with best-effort remote retention", async () => {
    const nowMs = 10_000_000;
    const expiredName = `${randomUUID()}.png`;
    const freshName = `${randomUUID()}.png`;
    const unlinked: string[] = [];
    const base = fakeSftp({});
    const sftp = base.sftp as ImageSftpClient & {
      readdir: (dir: string, callback: (err: Error | undefined, entries: Array<{ filename: string; attrs?: { mtime?: number } }>) => void) => void;
      unlink: (remotePath: string, callback: (err?: Error) => void) => void;
    };
    sftp.readdir = (_dir, callback) =>
      callback(undefined, [
        { filename: expiredName, attrs: { mtime: (nowMs - 7_200_000) / 1000 } },
        { filename: freshName, attrs: { mtime: nowMs / 1000 } },
        { filename: "other.txt", attrs: { mtime: 0 } },
      ]);
    sftp.unlink = (remotePath, callback) => {
      unlinked.push(remotePath);
      callback();
    };

    await storeImageViaSftp(sftp, PNG_BYTES, {
      ttlMs: 3_600_000,
      nowMs,
    });

    expect(unlinked).toEqual([`${REMOTE_IMAGE_DIR}/${expiredName}`]);
  });
  it("fails closed when remote quota inspection fails", async () => {
    const { sftp } = fakeSftp({ readdirError: new Error("remote listing failed") });
    const error = await storeImageViaSftp(sftp, PNG_BYTES, {
      maxCount: 10,
      maxBytes: 1024,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TerminalImageStorageError);
    expect((error as TerminalImageStorageError).code).toBe(
      "IMAGE_REMOTE_QUOTA_UNAVAILABLE",
    );
  });

  it("rejects remote writes at the configured count limit", async () => {
    const { sftp } = fakeSftp({
      readdirEntries: [{ filename: `${randomUUID()}.png`, size: 12 }],
    });
    const error = await storeImageViaSftp(sftp, PNG_BYTES, {
      maxCount: 1,
      maxBytes: 1024,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TerminalImageStorageError);
    expect((error as TerminalImageStorageError).code).toBe(
      "IMAGE_STORAGE_LIMIT_REACHED",
    );
  });

  it("destroys a stalled SFTP write after its timeout", async () => {
    const { sftp, streams } = fakeSftp({ stallWrite: true });
    const error = await storeImageViaSftp(sftp, PNG_BYTES, {
      writeTimeoutMs: 25,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TerminalImageStorageError);
    expect((error as TerminalImageStorageError).code).toBe(
      "IMAGE_REMOTE_WRITE_FAILED",
    );
    expect(streams[0]!.destroyed).toBe(true);
  });
  it("rejects an existing remote path that is not a directory", async () => {
    const { sftp } = fakeSftp({
      mkdirError: new Error("Failure: file already exists"),
      statMode: 0o100644,
    });
    const error = await storeImageViaSftp(sftp, PNG_BYTES).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(TerminalImageStorageError);
    expect((error as TerminalImageStorageError).code).toBe(
      "IMAGE_REMOTE_WRITE_FAILED",
    );
  });

  it("tolerates mkdir failures for an already-existing directory", async () => {
    const { sftp } = fakeSftp({
      mkdirError: new Error("Failure: file already exists"),
    });
    await expect(storeImageViaSftp(sftp, PNG_BYTES)).resolves.toMatchObject({
      storage: "remote-sftp",
    });
  });

  it("cleans up a partially created remote file after a write failure", async () => {
    const { sftp } = fakeSftp({ writeError: new Error("write failed") });
    const unlinked: string[] = [];
    (sftp as ImageSftpClient).unlink = (remotePath, callback) => {
      unlinked.push(remotePath);
      callback();
    };

    const error = await storeImageViaSftp(sftp, PNG_BYTES).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(TerminalImageStorageError);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toMatch(new RegExp(`${REMOTE_IMAGE_DIR}/[0-9a-f-]+\\.png`));
  });

  it("recovers a stale remote lock before writing", async () => {
    const base = fakeSftp({});
    const sftp = base.sftp as ImageSftpClient;
    const lockPath = `${REMOTE_IMAGE_DIR}/.termix-write-lock`;
    let lockAttempt = 0;
    const removed: string[] = [];
    const originalMkdir = sftp.mkdir.bind(sftp);
    sftp.mkdir = (dir, attrs, callback) => {
      if (dir === lockPath && lockAttempt++ === 0) {
        (typeof attrs === "function" ? attrs : callback!)(new Error("exists"));
        return;
      }
      originalMkdir(dir, attrs, callback);
    };
    sftp.lstat = (_dir, callback) =>
      callback(undefined, { mode: 0o40700, mtime: (Date.now() - 60_000) / 1000 });
    sftp.rmdir = (dir, callback) => {
      removed.push(dir);
      callback();
    };

    await expect(storeImageViaSftp(sftp, PNG_BYTES)).resolves.toMatchObject({
      storage: "remote-sftp",
    });
    expect(removed).toContain(lockPath);
  });

  it("does not replace a successful write with an unlock failure", async () => {
    const base = fakeSftp({});
    const sftp = base.sftp as ImageSftpClient;
    const lockPath = `${REMOTE_IMAGE_DIR}/.termix-write-lock`;
    const originalMkdir = sftp.mkdir.bind(sftp);
    sftp.mkdir = (dir, attrs, callback) =>
      originalMkdir(dir, attrs, callback);
    sftp.rmdir = (dir, callback) => {
      if (dir === lockPath) callback(new Error("unlock failed"));
      else callback();
    };

    const error = await storeImageViaSftp(sftp, PNG_BYTES).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(TerminalImageStorageError);
    expect((error as TerminalImageStorageError).code).toBe(
      "IMAGE_REMOTE_WRITE_FAILED",
    );
  });

  it("maps SFTP failures to IMAGE_REMOTE_WRITE_FAILED", async () => {
    const { sftp } = fakeSftp({ writeError: new Error("Permission denied") });
    const error = await storeImageViaSftp(sftp, PNG_BYTES).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(TerminalImageStorageError);
    expect((error as TerminalImageStorageError).code).toBe(
      "IMAGE_REMOTE_WRITE_FAILED",
    );
    expect((error as TerminalImageStorageError).message).toBe(
      "Failed to write image to the remote host",
    );
  });
});
