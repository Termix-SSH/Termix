import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express, Request, Response } from "express";
import { PassThrough, Writable } from "node:stream";
import type { SSHSession } from "../../../hosts/file-manager/session.js";

const mocks = vi.hoisted(() => ({ getSessionSftp: vi.fn() }));
vi.mock("../../../hosts/file-manager/session.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../hosts/file-manager/session.js")
  >()),
  getSessionSftp: mocks.getSessionSftp,
}));

import { registerFileContentRoutes } from "../../../hosts/file-manager/content-routes.js";

type RouteHandler = (request: Request, response: Response) => unknown;

/**
 * Behaves like ssh2's SFTP WriteStream on current Node: it destroys itself
 * inside `_final` (autoClose), so a `finish` event is never emitted; only
 * `close` follows the last acknowledged write.
 */
class Ssh2LikeWriteStream extends Writable {
  chunks: Buffer[] = [];
  constructor() {
    super({ emitClose: false, autoDestroy: false });
  }
  _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
    this.chunks.push(Buffer.from(chunk));
    cb();
  }
  _final(cb: () => void) {
    this.destroy();
    cb();
  }
  _destroy(err: Error | null, cb: (err: Error | null) => void) {
    // The handle close round-trip happens later; 'close' is asynchronous.
    setTimeout(() => {
      cb(err);
      this.emit("close");
    }, 5);
  }
  get body() {
    return Buffer.concat(this.chunks);
  }
}

function setup() {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get: vi.fn(),
    post: (path: string, handler: RouteHandler) => routes.set(path, handler),
  } as unknown as Express;
  const session = { isConnected: true, lastActive: 0 } as SSHSession;
  registerFileContentRoutes(app, {
    sshSessions: { s1: session },
    verifySessionOwnership: () => true,
  });
  const writeStream = new Ssh2LikeWriteStream();
  const unlink = vi.fn((_p: string, cb: (e: null) => void) => cb(null));
  mocks.getSessionSftp.mockResolvedValue({
    createWriteStream: vi.fn(() => writeStream),
    unlink,
  });
  const response = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  vi.mocked(response.status).mockReturnValue(response);
  const responded = new Promise<unknown>((resolve) => {
    vi.mocked(response.json).mockImplementation((payload: unknown) => {
      resolve(payload);
      return response;
    });
  });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("route never responded")), 2000),
  );
  return {
    routes,
    writeStream,
    unlink,
    response,
    responded: Promise.race([responded, timeout]),
  };
}

beforeEach(() => mocks.getSessionSftp.mockReset());

describe("uploadFileStream completion", () => {
  function multipartRequest(body: Buffer, fields: Record<string, string>) {
    const boundary = "----termixTestBoundary";
    let preamble = "";
    for (const [k, v] of Object.entries(fields)) {
      preamble += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
    }
    preamble += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="payload.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const req = new PassThrough() as PassThrough & Request;
    Object.assign(req, {
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      userId: "u1",
      complete: false,
    });
    const send = async () => {
      req.write(preamble);
      req.write(body);
      req.write(`\r\n--${boundary}--\r\n`);
      (req as { complete: boolean }).complete = true;
      req.end();
    };
    return { req, send };
  }

  it("answers once the SFTP stream closes, even though ssh2 never emits 'finish'", async () => {
    const { routes, writeStream, response, responded } = setup();
    const payload = Buffer.from("hello over sftp");
    const { req, send } = multipartRequest(payload, {
      sessionId: "s1",
      path: "/home/ubuntu",
    });
    routes.get("/ssh/file_manager/ssh/uploadFileStream")!(req, response);
    await send();
    const answer = (await responded) as { message: string; path: string };
    expect(answer.message).toBe("File uploaded successfully");
    expect(answer.path).toBe("/home/ubuntu/payload.bin");
    expect(writeStream.body.equals(payload)).toBe(true);
    expect(vi.mocked(response.status)).not.toHaveBeenCalled();
  });

  it("does not report success when the client aborts before the body ended", async () => {
    const { routes, writeStream, unlink, response } = setup();
    const { req } = multipartRequest(Buffer.alloc(0), {
      sessionId: "s1",
      path: "/home/ubuntu",
    });
    routes.get("/ssh/file_manager/ssh/uploadFileStream")!(req, response);
    // Headers + the beginning of the file part arrive, then the socket dies.
    req.write(
      `------termixTestBoundary\r\nContent-Disposition: form-data; name="sessionId"\r\n\r\ns1\r\n` +
        `------termixTestBoundary\r\nContent-Disposition: form-data; name="path"\r\n\r\n/home/ubuntu\r\n` +
        `------termixTestBoundary\r\nContent-Disposition: form-data; name="file"; filename="payload.bin"\r\n\r\npartial`,
    );
    await new Promise((r) => setTimeout(r, 20));
    req.emit("aborted");
    // The partial is removed and its stream closes; that close is not a success.
    await new Promise((r) => setTimeout(r, 50));
    expect(writeStream.destroyed).toBe(true);
    expect(unlink).toHaveBeenCalledWith(
      "/home/ubuntu/payload.bin",
      expect.any(Function),
    );
    expect(vi.mocked(response.json)).not.toHaveBeenCalled();
  });
});

describe("uploadFileChunk completion", () => {
  function chunkRequest(query: Record<string, string>) {
    const req = new PassThrough() as PassThrough & Request;
    Object.assign(req, { query, headers: {}, userId: "u1" });
    return req;
  }
  const query = {
    sessionId: "s1",
    path: "/home/ubuntu",
    fileName: "big.bin",
    offset: "0",
    totalSize: "6",
  };

  it("streams the raw body and answers on the ssh2 'close' event", async () => {
    const { routes, writeStream, response, responded } = setup();
    const req = chunkRequest(query);
    routes.get("/ssh/file_manager/ssh/uploadFileChunk")!(req, response);
    await new Promise((r) => setTimeout(r, 10)); // let getSessionSftp resolve
    req.write("abc");
    req.end("def");
    const answer = (await responded) as {
      bytesWritten: number;
      nextOffset: number;
      complete: boolean;
    };
    expect(answer).toMatchObject({
      bytesWritten: 6,
      nextOffset: 6,
      complete: true,
    });
    expect(writeStream.body.toString()).toBe("abcdef");
  });

  it("still writes the chunk when middleware already drained the body into req.body", async () => {
    const { routes, writeStream, response, responded } = setup();
    const req = chunkRequest(query);
    // What express.raw() leaves behind: a Buffer body and an ended stream.
    Object.assign(req, { body: Buffer.from("abcdef") });
    req.end();
    routes.get("/ssh/file_manager/ssh/uploadFileChunk")!(req, response);
    const answer = (await responded) as { bytesWritten: number };
    expect(answer.bytesWritten).toBe(6);
    expect(writeStream.body.toString()).toBe("abcdef");
  });
});
