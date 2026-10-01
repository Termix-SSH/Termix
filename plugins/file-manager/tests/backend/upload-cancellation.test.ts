import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { Express, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { registerFileContentRoutes } from "../../src/backend/content-routes";
import type { SSHSession } from "../../src/backend/session";

const { getSessionSftp } = vi.hoisted(() => ({ getSessionSftp: vi.fn() }));
vi.mock("../../src/backend/session.js", () => ({ getSessionSftp }));

function setup(route = "/uploadFileChunk") {
  const routes = new Map<string, (req: Request, res: Response) => void>();
  const app = {
    get: vi.fn(),
    post: (path: string, handler: (req: Request, res: Response) => void) =>
      routes.set(path, handler),
  } as unknown as Express;
  registerFileContentRoutes(app, {
    ctx: {
      currentActor: () => "user-1",
      log: { info: vi.fn(), error: vi.fn() },
    } as unknown as PluginContext,
    sshSessions: { s: { isConnected: true } as SSHSession },
    verifySessionOwnership: () => true,
  });
  const req = Object.assign(new PassThrough(), {
    query: {
      sessionId: "s",
      path: "/",
      fileName: "upload.bin",
      offset: "0",
      totalSize: "4",
    },
    headers: { "content-type": "multipart/form-data; boundary=test-boundary" },
    body: Buffer.from("data"),
    complete: true,
  });
  const res = Object.assign(new EventEmitter(), {
    writableFinished: false,
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  });
  const start = () =>
    routes.get(route)!(req as unknown as Request, res as unknown as Response);
  return { req, res, start };
}

function sftp() {
  // Keep the SSH write pending after HTTP has received the complete body.
  const stream = new Writable({ write() {} });
  return { stream, createWriteStream: vi.fn(() => stream) };
}

describe("chunk upload disconnects", () => {
  it("stops SSH writes when the client disconnects after sending its body", async () => {
    const remote = sftp();
    getSessionSftp.mockResolvedValue(remote);
    const { res, start } = setup();
    start();
    await Promise.resolve();
    expect(remote.createWriteStream).toHaveBeenCalledOnce();
    res.emit("close");
    expect(remote.stream.destroyed).toBe(true);
    remote.stream.emit("finish");
    expect(res.json).not.toHaveBeenCalled();
  });

  it("does not open a remote file if cancelled while waiting for SFTP", async () => {
    const remote = sftp();
    let connect!: (value: typeof remote) => void;
    getSessionSftp.mockReturnValue(
      new Promise((resolve) => {
        connect = resolve;
      }),
    );
    const { res, start } = setup();
    start();
    res.emit("close");
    connect(remote);
    await Promise.resolve();
    expect(remote.createWriteStream).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    remote.stream.destroy();
  });

  it("does not cancel a successfully completed response", async () => {
    const remote = sftp();
    getSessionSftp.mockResolvedValue(remote);
    const { res, start } = setup();
    start();
    await Promise.resolve();
    remote.stream.emit("finish");
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ complete: true }),
    );
    res.writableFinished = true;
    res.emit("close");
    expect(remote.stream.destroyed).toBe(false);
    remote.stream.destroy();
  });
});

describe("multipart upload disconnects", () => {
  it("keeps normal request completion alive but cancels unfinished SSH writes on response disconnect", async () => {
    const remote = {
      ...sftp(),
      unlink: vi.fn((_path, callback) => callback(null)),
    };
    getSessionSftp.mockResolvedValue(remote);
    const { req, res, start } = setup("/uploadFileStream");
    start();
    req.end(
      [
        "--test-boundary",
        'Content-Disposition: form-data; name="sessionId"',
        "",
        "s",
        "--test-boundary",
        'Content-Disposition: form-data; name="path"',
        "",
        "/",
        "--test-boundary",
        'Content-Disposition: form-data; name="file"; filename="a.txt"',
        "Content-Type: text/plain",
        "",
        "data",
        "--test-boundary--",
        "",
      ].join("\r\n"),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(remote.createWriteStream).toHaveBeenCalledWith("/a.txt");
    req.emit("close");
    expect(remote.stream.destroyed).toBe(false);
    res.emit("close");
    expect(remote.stream.destroyed).toBe(true);
    expect(remote.unlink).toHaveBeenCalledWith("/a.txt", expect.any(Function));
    expect(res.json).not.toHaveBeenCalled();
  });
});
