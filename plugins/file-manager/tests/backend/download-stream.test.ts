import { once } from "node:events";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { SFTPWrapper } from "ssh2";
import { describe, expect, it, vi } from "vitest";
import { createDownloadStream } from "../../src/backend/download-stream.js";

function source(
  data: Buffer,
  options: { shortRead?: number; failAt?: number } = {},
) {
  let pending = 0;
  let peak = 0;
  const closedWithPending: number[] = [];
  const sftp = {
    open: vi.fn((_path, _flags, _mode, cb) =>
      cb(undefined, Buffer.from("handle")),
    ),
    close: vi.fn((_handle, cb) => {
      closedWithPending.push(pending);
      cb();
    }),
    read: vi.fn((_handle, buffer, offset, length, position, cb) => {
      peak = Math.max(peak, ++pending);
      // Later file offsets can finish first.
      setTimeout(
        () => {
          pending--;
          if (position === options.failAt) return cb(new Error("read failed"));
          const bytes = Math.min(
            length,
            options.shortRead ?? length,
            Math.max(0, data.length - position),
          );
          if (bytes > 0) data.copy(buffer, offset, position, position + bytes);
          cb(undefined, bytes);
        },
        position === 0 ? 10 : 0,
      );
    }),
  };
  return {
    sftp: sftp as unknown as SFTPWrapper,
    close: sftp.close,
    read: sftp.read,
    peak: () => peak,
    closedWithPending,
  };
}

async function contents(stream: ReturnType<typeof createDownloadStream>) {
  const buffers: Buffer[] = [];
  for await (const buffer of stream) buffers.push(buffer);
  return Buffer.concat(buffers);
}

describe("SFTP download stream", () => {
  it("pipelines bounded reads and preserves bytes despite out-of-order replies", async () => {
    const data = Buffer.alloc(1024 * 1024 + 123);
    for (let i = 0; i < data.length; i++) data[i] = (i * 13 + (i >>> 8)) % 256;
    const remote = source(data);
    expect(
      await contents(createDownloadStream(remote.sftp, "/file", data.length)),
    ).toEqual(data);
    expect(remote.peak()).toBe(8);
    expect(remote.closedWithPending).toEqual([0]);
  });

  it("fills short server reads without losing or repeating bytes", async () => {
    const data = Buffer.from("short reads ".repeat(10000));
    const remote = source(data, { shortRead: 4096 });
    expect(
      await contents(createDownloadStream(remote.sftp, "/file", data.length)),
    ).toEqual(data);
    expect(remote.closedWithPending).toEqual([0]);
  });

  it("handles empty files without issuing reads", async () => {
    const remote = source(Buffer.alloc(0));
    expect(
      await contents(createDownloadStream(remote.sftp, "/empty", 0)),
    ).toEqual(Buffer.alloc(0));
    expect(remote.read).not.toHaveBeenCalled();
    expect(remote.close).toHaveBeenCalledOnce();
  });

  it("fails on premature EOF instead of returning uninitialized bytes", async () => {
    const remote = source(Buffer.from("truncated"));
    await expect(
      contents(createDownloadStream(remote.sftp, "/file", 100000)),
    ).rejects.toThrow("File ended");
    expect(remote.closedWithPending).toEqual([0]);
  });

  it("settles outstanding reads before closing on a read failure", async () => {
    const remote = source(Buffer.alloc(1024 * 1024), { failAt: 32768 });
    await expect(
      contents(createDownloadStream(remote.sftp, "/file", 1024 * 1024)),
    ).rejects.toThrow("read failed");
    expect(remote.read).toHaveBeenCalledTimes(8);
    expect(remote.closedWithPending).toEqual([0]);
  });

  it("stops scheduling reads and closes the handle when destroyed mid-batch", async () => {
    const remote = source(Buffer.alloc(1024 * 1024), { shortRead: 4096 });
    const replies: Array<() => void> = [];
    remote.read.mockImplementation(
      (_handle, _buffer, _offset, _length, _position, cb) => {
        replies.push(() => cb(undefined, 4096));
      },
    );
    const stream = createDownloadStream(remote.sftp, "/file", 1024 * 1024);
    stream.resume();
    await nextTurn();
    const closed = once(stream, "close");
    stream.destroy();
    for (const reply of replies) reply();
    await closed;
    expect(remote.read).toHaveBeenCalledTimes(8);
    expect(remote.closedWithPending).toEqual([0]);
  });

  it("bounds read-ahead while the consumer is paused", async () => {
    const remote = source(Buffer.alloc(8 * 1024 * 1024));
    const stream = createDownloadStream(remote.sftp, "/file", 8 * 1024 * 1024);
    stream.read(0);
    await once(stream, "readable");
    expect(remote.read).toHaveBeenCalledTimes(8);
    const closed = once(stream, "close");
    stream.destroy();
    await closed;
    expect(remote.closedWithPending).toEqual([0]);
  });
});
