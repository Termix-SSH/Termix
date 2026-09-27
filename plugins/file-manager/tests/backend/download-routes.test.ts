import { once } from "node:events";
import { PassThrough } from "node:stream";
import type { Express, Request, Response } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { describe, expect, it, vi } from "vitest";
import { registerFileDownloadRoutes } from "../../src/backend/download-routes.js";
import type { SSHSession } from "../../src/backend/session.js";

function setup(remote: object, owned = true) {
  const routes = new Map<
    string,
    (req: Request, res: Response) => Promise<unknown>
  >();
  registerFileDownloadRoutes(
    { post: (path, handler) => routes.set(path, handler) } as Express,
    {
      ctx: {
        currentActor: () => "user",
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as unknown as PluginContext,
      sshSessions: { s: { isConnected: true, sftp: remote } as SSHSession },
      scheduleSessionCleanup: vi.fn(),
      verifySessionOwnership: () => owned,
    },
  );
  const headers = new Map<string, string>();
  const res = Object.assign(new PassThrough(), {
    headersSent: false,
    setHeader: (name: string, value: string) => headers.set(name, value),
    removeHeader: (name: string) => headers.delete(name),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  });
  const start = () =>
    routes.get("/downloadFileStream")!(
      { body: { sessionId: "s", path: "/file" } } as Request,
      res as unknown as Response,
    );
  return { res, start, headers };
}

function source() {
  return {
    stat: vi.fn((_path, cb) => cb(undefined, { size: 5, isFile: () => true })),
    open: vi.fn((_path, _flags, _mode, cb) =>
      cb(undefined, Buffer.from("handle")),
    ),
    read: vi.fn((_handle, buffer, offset, _length, _position, cb) => {
      Buffer.from("hello").copy(buffer, offset);
      cb(undefined, 5);
    }),
    close: vi.fn((_handle, cb) => cb()),
  };
}

describe("stream download route", () => {
  it("streams the file content with its advertised length", async () => {
    const remote = source();
    const { res, start, headers } = setup(remote);
    await start();
    const chunks: Buffer[] = [];
    for await (const chunk of res) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe("hello");
    expect(headers.get("Content-Length")).toBe("5");
    expect(remote.close).toHaveBeenCalledOnce();
  });

  it("does not open a file after the HTTP client disconnected during stat", async () => {
    const remote = source();
    let finishStat!: () => void;
    remote.stat.mockImplementation((_path, cb) => {
      finishStat = () => cb(undefined, { size: 5, isFile: () => true });
    });
    const { res, start } = setup(remote);
    const started = start();
    await Promise.resolve();
    res.destroy();
    finishStat();
    await started;
    expect(remote.open).not.toHaveBeenCalled();
  });

  it("closes the SFTP handle after HTTP disconnect during a read", async () => {
    const remote = source();
    let finishRead!: () => void;
    remote.read.mockImplementation(
      (_h, buffer, offset, length, position, cb) => {
        finishRead = () => cb(undefined, 0);
      },
    );
    const { res, start } = setup(remote);
    await start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    res.destroy();
    await once(res, "close");
    finishRead();
    await vi.waitFor(() => expect(remote.close).toHaveBeenCalledOnce());
    expect(remote.read).toHaveBeenCalledOnce();
  });

  it("removes the file length before returning an early stream error as JSON", async () => {
    const remote = source();
    remote.open.mockImplementation((_p, _f, _m, cb) =>
      cb(new Error("permission denied"), undefined),
    );
    const { res, start, headers } = setup(remote);
    await start();
    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(500));
    expect(headers.has("Content-Length")).toBe(false);
    expect(res.json).toHaveBeenCalledWith({
      error: "Download failed: permission denied",
    });
    res.destroy();
  });

  it("refuses another user's SSH session before reading a file", async () => {
    const remote = source();
    const { res, start } = setup(remote, false);
    await start();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(remote.stat).not.toHaveBeenCalled();
    res.destroy();
  });
});
