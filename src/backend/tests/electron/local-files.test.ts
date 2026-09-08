import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

const require = createRequire(import.meta.url);
const localFiles = require("../../../../electron/local-files.cjs") as {
  IPC: Record<string, string>;
  TRANSFER_ROUTES: Record<string, string>;
  createTargetResolver: (deps: {
    localBaseUrl?: string;
    getRemoteSyncConfig?: () => { serverUrl?: string } | null;
    getRemoteSyncJwt?: () => string | null;
  }) => (req: { origin?: unknown; route?: unknown; deviceId?: unknown }) => {
    url: string;
    headers: Record<string, string>;
  };
  createLocalFileHandlers: (deps: {
    net: unknown;
    shell: unknown;
    getRemoteSyncConfig?: () => { serverUrl?: string } | null;
    getRemoteSyncJwt?: () => string | null;
    localBaseUrl?: string;
  }) => Record<
    string,
    (
      event: unknown,
      ...args: unknown[]
    ) => Promise<
      { success: boolean; error?: string; code?: string } & Record<
        string,
        unknown
      >
    >
  >;
};

// Minimal stand-in for Electron's net.request built on Node http, exposing
// the subset of the ClientRequest API local-files.cjs uses.
class FakeClientRequest extends EventEmitter {
  private req: http.ClientRequest;
  chunkedEncoding = false;
  constructor(opts: { method: string; url: string }) {
    super();
    const u = new URL(opts.url);
    this.req = http.request({
      method: opts.method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
    });
    this.req.on("response", (res) => this.emit("response", res));
    this.req.on("error", (e) => this.emit("error", e));
  }
  setHeader(k: string, v: string) {
    this.req.setHeader(k, v);
  }
  write(chunk: Buffer | string, cb?: () => void) {
    return this.req.write(chunk, cb);
  }
  end() {
    this.req.end();
  }
  abort() {
    this.req.destroy();
    this.emit("abort");
  }
}

const fakeNet = {
  request: (opts: { method: string; url: string }) =>
    new FakeClientRequest(opts),
};

const fakeEvent = {
  sender: { session: null, isDestroyed: () => false, send: () => {} },
};

// A backend stand-in: records what it receives and serves a fixed payload on
// the download route (optionally slowly, to exercise concurrency).
function startBackend(
  payload: Buffer,
  opts: { delayMs?: number; failAll?: boolean } = {},
) {
  const seen: Array<{ url: string; headers: http.IncomingHttpHeaders }> = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url || "", headers: req.headers });
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (!opts.failAll && req.url?.endsWith("/ssh/downloadFileStream")) {
        // Headers go out immediately so the client opens its temp file;
        // the body may be delayed to keep the transfer in flight.
        res.writeHead(200, { "Content-Length": payload.length });
        res.flushHeaders();
        const send = () => res.end(payload);
        if (opts.delayMs) setTimeout(send, opts.delayMs);
        else send();
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: `no route ${req.url}` }));
    });
  });
  return new Promise<{
    url: string;
    seen: typeof seen;
    close: () => Promise<void>;
  }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${address.port}/ssh/file_manager`,
        seen,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe("local-files transfer target resolution", () => {
  const resolve = localFiles.createTargetResolver({
    localBaseUrl: "http://127.0.0.1:30004/ssh/file_manager",
    getRemoteSyncConfig: () => ({ serverUrl: "https://termix.example.com/" }),
    getRemoteSyncJwt: () => "remote-jwt",
  });

  it("only reaches the two file-manager streaming routes on the local backend", () => {
    expect(resolve({ origin: "local", route: "uploadFileStream" })).toEqual({
      url: "http://127.0.0.1:30004/ssh/file_manager/ssh/uploadFileStream",
      headers: { "X-Electron-App": "true" },
    });
    expect(resolve({ origin: "local", route: "downloadFileStream" }).url).toBe(
      "http://127.0.0.1:30004/ssh/file_manager/ssh/downloadFileStream",
    );
  });

  it("derives the remote target from the configured sync server and attaches its JWT itself", () => {
    const target = resolve({ origin: "remote", route: "downloadFileStream" });
    expect(target.url).toBe(
      "https://termix.example.com/ssh/file_manager/ssh/downloadFileStream",
    );
    expect(target.headers.Authorization).toBe("Bearer remote-jwt");
  });

  it("refuses unknown origins, routes, and off-origin URLs smuggled as either", () => {
    expect(() =>
      resolve({ origin: "https://evil.example", route: "uploadFileStream" }),
    ).toThrow(/Unknown transfer origin/);
    expect(() => resolve({ origin: "local", route: "/../admin" })).toThrow(
      /Unknown transfer route/,
    );
    expect(() =>
      resolve({ origin: "local", route: "http://evil.example/x" }),
    ).toThrow(/Unknown transfer route/);
    expect(() => resolve({})).toThrow(/Unknown transfer route/);
  });

  it("refuses a remote origin when no sync server is configured or it is not http(s)", () => {
    const unconfigured = localFiles.createTargetResolver({
      getRemoteSyncConfig: () => null,
    });
    expect(() =>
      unconfigured({ origin: "remote", route: "uploadFileStream" }),
    ).toThrow(/not configured/);
    const bogus = localFiles.createTargetResolver({
      getRemoteSyncConfig: () => ({ serverUrl: "file:///etc/passwd" }),
    });
    expect(() =>
      bogus({ origin: "remote", route: "uploadFileStream" }),
    ).toThrow(/must use http or https/);
  });

  it("accepts only a well-formed device id and never arbitrary headers", () => {
    expect(
      resolve({
        origin: "local",
        route: "uploadFileStream",
        deviceId: "dev_1.2:3-x",
      }).headers["X-Termix-Device-ID"],
    ).toBe("dev_1.2:3-x");
    expect(() =>
      resolve({
        origin: "local",
        route: "uploadFileStream",
        deviceId: "x\r\nHost: evil",
      }),
    ).toThrow(/Invalid device id/);
    const headers = resolve({
      origin: "local",
      route: "uploadFileStream",
    }).headers;
    expect(Object.keys(headers)).toEqual(["X-Electron-App"]);
  });
});

describe("local-files download boundary", () => {
  let root: string;
  const payload = crypto.randomBytes(64 * 1024 + 7);
  let backend: Awaited<ReturnType<typeof startBackend>>;
  let handlers: ReturnType<typeof localFiles.createLocalFileHandlers>;

  beforeAll(async () => {
    backend = await startBackend(payload);
    handlers = localFiles.createLocalFileHandlers({
      net: fakeNet,
      shell: {},
      localBaseUrl: backend.url,
      getRemoteSyncConfig: () => null,
      getRemoteSyncJwt: () => null,
    });
  });
  afterAll(() => backend.close());
  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "termix-local-files-"));
  });
  afterEach(() => fsp.rm(root, { recursive: true, force: true }));

  const download = (
    dest: string,
    extra: Record<string, unknown> = {},
    transferId = `t-${Math.random().toString(36).slice(2)}`,
  ) =>
    handlers[localFiles.IPC.DOWNLOAD](fakeEvent, {
      transferId,
      origin: "local",
      body: { sessionId: "1", path: "/remote/file.bin" },
      destPath: dest,
      ...extra,
    });

  it("ignores renderer-supplied url/headers and talks to the resolved backend only", async () => {
    const dest = path.join(root, "a.bin");
    const result = await download(dest, {
      url: "http://evil.example/steal",
      headers: { Authorization: "Bearer leaked", Cookie: "jwt=leaked" },
    });
    expect(result.success).toBe(true);
    const last = backend.seen[backend.seen.length - 1];
    expect(last.url).toBe("/ssh/file_manager/ssh/downloadFileStream");
    expect(last.headers.authorization).toBeUndefined();
    expect(last.headers.cookie).toBeUndefined();
    expect(last.headers["x-electron-app"]).toBe("true");
    expect((await fsp.readFile(dest)).equals(payload)).toBe(true);
  });

  it("refuses to replace an existing file by default and leaves it untouched", async () => {
    const dest = path.join(root, "keep.bin");
    await fsp.writeFile(dest, "original");
    const requestsBefore = backend.seen.length;

    const result = await download(dest);
    expect(result.success).toBe(false);
    expect(result.code).toBe("EEXIST");
    expect(await fsp.readFile(dest, "utf8")).toBe("original");
    // Refused before any network traffic.
    expect(backend.seen.length).toBe(requestsBefore);
    expect(await fsp.readdir(root)).toEqual(["keep.bin"]);
  });

  it("replaces an existing file only when overwrite is explicitly requested", async () => {
    const dest = path.join(root, "replace.bin");
    await fsp.writeFile(dest, "original");
    const result = await download(dest, { overwrite: true });
    expect(result.success).toBe(true);
    expect((await fsp.readFile(dest)).equals(payload)).toBe(true);
    expect(await fsp.readdir(root)).toEqual(["replace.bin"]);
  });

  it("refuses to publish over a file that appeared while the download was running", async () => {
    const slow = await startBackend(payload, { delayMs: 300 });
    const slowHandlers = localFiles.createLocalFileHandlers({
      net: fakeNet,
      shell: {},
      localBaseUrl: slow.url,
    });
    try {
      const dest = path.join(root, "race.bin");
      const pending = slowHandlers[localFiles.IPC.DOWNLOAD](fakeEvent, {
        transferId: "race-1",
        origin: "local",
        body: {},
        destPath: dest,
      });
      await new Promise((r) => setTimeout(r, 100));
      await fsp.writeFile(dest, "someone else wrote this");
      const result = await pending;
      expect(result.success).toBe(false);
      expect(result.code).toBe("EEXIST");
      expect(await fsp.readFile(dest, "utf8")).toBe("someone else wrote this");
      expect(await fsp.readdir(root)).toEqual(["race.bin"]);
    } finally {
      await slow.close();
    }
  });

  it("uses a transfer-unique temp file and rejects a concurrent download to the same destination", async () => {
    const slow = await startBackend(payload, { delayMs: 300 });
    const slowHandlers = localFiles.createLocalFileHandlers({
      net: fakeNet,
      shell: {},
      localBaseUrl: slow.url,
    });
    try {
      const dest = path.join(root, "same.bin");
      const first = slowHandlers[localFiles.IPC.DOWNLOAD](fakeEvent, {
        transferId: "first",
        origin: "local",
        body: {},
        destPath: dest,
      });
      await new Promise((r) => setTimeout(r, 50));
      const second = await slowHandlers[localFiles.IPC.DOWNLOAD](fakeEvent, {
        transferId: "second",
        origin: "local",
        body: {},
        destPath: dest,
      });
      expect(second.success).toBe(false);
      expect(second.code).toBe("EBUSY");

      // While the first is in flight its partial carries the transfer id.
      const partials = (await fsp.readdir(root)).filter((n) =>
        n.endsWith(".termix-part"),
      );
      expect(partials).toEqual(["same.bin.first.termix-part"]);

      const result = await first;
      expect(result.success).toBe(true);
      expect((await fsp.readFile(dest)).equals(payload)).toBe(true);
      expect(await fsp.readdir(root)).toEqual(["same.bin"]);
    } finally {
      await slow.close();
    }
  });

  it("allows two downloads of different files to run side by side", async () => {
    const [a, b] = await Promise.all([
      download(path.join(root, "one.bin")),
      download(path.join(root, "two.bin")),
    ]);
    expect(a.success && b.success).toBe(true);
    expect((await fsp.readdir(root)).sort()).toEqual(["one.bin", "two.bin"]);
  });

  it("cleans up its partial file and never creates the destination on a backend error", async () => {
    const failingBackend = await startBackend(payload, { failAll: true });
    const failing = localFiles.createLocalFileHandlers({
      net: fakeNet,
      shell: {},
      localBaseUrl: failingBackend.url,
    });
    try {
      const bad = await failing[localFiles.IPC.DOWNLOAD](fakeEvent, {
        transferId: "err",
        origin: "local",
        body: {},
        destPath: path.join(root, "never.bin"),
      });
      expect(bad.success).toBe(false);
      expect(bad.error).toMatch(/no route/);
      expect(fs.existsSync(path.join(root, "never.bin"))).toBe(false);
      expect(await fsp.readdir(root)).toEqual([]);
    } finally {
      await failingBackend.close();
    }
  });

  it("reports which destinations already exist for the collision prompt", async () => {
    const present = path.join(root, "present.txt");
    await fsp.writeFile(present, "x");
    const result = await handlers[localFiles.IPC.EXISTS](fakeEvent, [
      present,
      path.join(root, "absent.txt"),
    ]);
    expect(result.success).toBe(true);
    expect(result.existing).toEqual([present]);
  });
});

describe("local-files upload boundary", () => {
  it("streams the file as multipart to the resolved backend and ignores renderer url/headers", async () => {
    const Busboy = require("busboy") as (opts: {
      headers: http.IncomingHttpHeaders;
    }) => NodeJS.EventEmitter & NodeJS.WritableStream;
    const received: {
      fields: Record<string, string>;
      fileName?: string;
      hash?: string;
      url?: string;
      headers?: http.IncomingHttpHeaders;
    } = { fields: {} };

    const server = http.createServer((req, res) => {
      received.url = req.url;
      received.headers = req.headers;
      const bb = Busboy({ headers: req.headers });
      bb.on("field", (name: string, value: string) => {
        received.fields[name] = value;
      });
      bb.on(
        "file",
        (
          _name: string,
          stream: NodeJS.ReadableStream,
          info: { filename: string },
        ) => {
          received.fileName = info.filename;
          const hash = crypto.createHash("sha256");
          stream.on("data", (d: Buffer) => hash.update(d));
          stream.on("end", () => {
            received.hash = hash.digest("hex");
          });
        },
      );
      bb.on("close", () => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ message: "ok" }));
      });
      req.pipe(bb);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;

    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "termix-upload-"));
    const payload = crypto.randomBytes(3 * 1024 * 1024 + 11);
    const localPath = path.join(root, "big.bin");
    await fsp.writeFile(localPath, payload);

    try {
      const handlers = localFiles.createLocalFileHandlers({
        net: fakeNet,
        shell: {},
        localBaseUrl: `http://127.0.0.1:${port}/ssh/file_manager`,
      });
      const result = await handlers[localFiles.IPC.UPLOAD](fakeEvent, {
        transferId: "up-1",
        origin: "local",
        fields: { sessionId: "42", path: "/home/ubuntu" },
        localPath,
        fileName: "big renamed.bin",
        url: "http://evil.example/exfil",
        headers: { Authorization: "Bearer leaked" },
      });
      expect(result.success).toBe(true);
      expect(received.url).toBe("/ssh/file_manager/ssh/uploadFileStream");
      expect(received.headers?.authorization).toBeUndefined();
      expect(received.fields).toEqual({
        sessionId: "42",
        path: "/home/ubuntu",
      });
      expect(received.fileName).toBe("big renamed.bin");
      expect(received.hash).toBe(
        crypto.createHash("sha256").update(payload).digest("hex"),
      );
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an upload whose origin is not one of the two Termix backends", async () => {
    const handlers = localFiles.createLocalFileHandlers({
      net: fakeNet,
      shell: {},
      localBaseUrl: "http://127.0.0.1:1/ssh/file_manager",
    });
    const result = await handlers[localFiles.IPC.UPLOAD](fakeEvent, {
      transferId: "up-2",
      origin: "http://evil.example",
      fields: {},
      localPath: __filename,
      fileName: "x",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown transfer origin/);
  });
});
