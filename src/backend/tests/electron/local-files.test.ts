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

type PublishFs = {
  rename: (from: string, to: string) => Promise<void>;
  link: (from: string, to: string) => Promise<void>;
  copyFileExcl: (from: string, to: string) => Promise<void>;
  rm: (target: string) => Promise<void>;
  lstat: (target: string) => Promise<fs.Stats>;
};

const localFiles = require("../../../../electron/local-files.cjs") as {
  assertWithinRoot: (
    rootPath: string,
    candidate: string,
    pathImpl?: typeof path,
  ) => string;
  publishDownload: (
    partialPath: string,
    absDest: string,
    overwrite: boolean,
    transferId: string,
    io?: PublishFs,
  ) => Promise<void>;
  defaultPublishFs: PublishFs;
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
    publishFs?: PublishFs;
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
/** Header names the bridge tried to set on any request, lower-cased. */
const headersSetByBridge: string[] = [];

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
    headersSetByBridge.push(k.toLowerCase());
    this.req.setHeader(k, v);
  }
  write(chunk: Buffer | string, cb?: () => void) {
    return this.req.write(chunk, cb);
  }
  end(chunk?: Buffer | string) {
    this.req.end(chunk);
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

  it("sends the renderer's local token as a Bearer header so transfers outlive the jwt cookie", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1MSJ9.c2ln-_X";
    const target = resolve({
      origin: "local",
      route: "uploadFileStream",
      authToken: jwt,
    });
    expect(target.headers.Authorization).toBe(`Bearer ${jwt}`);
    expect(target.url).toBe(
      "http://127.0.0.1:30004/ssh/file_manager/ssh/uploadFileStream",
    );
    // Absent or empty: no header at all (the session cookie is the fallback).
    for (const authToken of [undefined, null, ""]) {
      expect(
        resolve({ origin: "local", route: "downloadFileStream", authToken })
          .headers.Authorization,
      ).toBeUndefined();
    }
  });

  it("refuses anything but a compact JWT as the local token", () => {
    for (const authToken of [
      "tmx_apikey",
      "a.b",
      "x\r\nX-Injected: 1",
      "Bearer abc.def.ghi",
      { toString: () => "a.b.c" },
      "a.b.".padEnd(9000, "c"),
    ]) {
      expect(() =>
        resolve({ origin: "local", route: "uploadFileStream", authToken }),
      ).toThrow(/Invalid auth token/);
    }
  });

  it("never lets the renderer's token replace the main process's Remote Sync JWT", () => {
    const target = resolve({
      origin: "remote",
      route: "uploadFileStream",
      authToken: "aaa.bbb.ccc",
    });
    expect(target.headers.Authorization).toBe("Bearer remote-jwt");
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
      rootPath: root,
      ...extra,
    });

  it("rejects existing linked parents for downloads and directory creation", async () => {
    const selected = path.join(root, "selected");
    const outside = path.join(root, "outside");
    await fsp.mkdir(selected);
    await fsp.mkdir(outside);
    await fsp.symlink(outside, path.join(selected, "linked"), "junction");
    const result = await download(path.join(selected, "linked", "file.bin"), {
      rootPath: selected,
    });
    expect(result.success).toBe(false);
    const mkdir = await handlers[localFiles.IPC.ENSURE_DIR](
      fakeEvent,
      path.join(selected, "linked", "new"),
      selected,
    );
    expect(mkdir.success).toBe(false);
    expect(await fsp.readdir(outside)).toEqual([]);
  });

  it("allows an explicitly selected linked root", async () => {
    const actual = path.join(root, "actual");
    const selected = path.join(root, "selected");
    await fsp.mkdir(actual);
    await fsp.symlink(actual, selected, "junction");
    const result = await download(path.join(selected, "nested", "file.bin"), {
      rootPath: selected,
    });
    expect(result.success).toBe(true);
    expect(await fsp.readFile(path.join(actual, "nested", "file.bin"))).toEqual(
      payload,
    );
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

  it("never sets headers Electron's net module forbids (the request would fail with ERR_INVALID_ARGUMENT)", async () => {
    headersSetByBridge.length = 0;
    const result = await download(path.join(root, "b.bin"));
    expect(result.success).toBe(true);
    // Electron computes Content-Length from the buffered body itself and
    // rejects requests that set it (or any other restricted header) by hand.
    const restricted = [
      "content-length",
      "host",
      "trailer",
      "te",
      "upgrade",
      "cookie2",
      "keep-alive",
      "transfer-encoding",
    ];
    expect(headersSetByBridge.filter((h) => restricted.includes(h))).toEqual(
      [],
    );
    // The JSON body still reached the backend intact.
    const last = backend.seen[backend.seen.length - 1];
    expect(last.headers["content-type"]).toBe("application/json");
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
        rootPath: root,
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

  it("rejects a destination parent replaced by a link during download", async () => {
    const selected = path.join(root, "selected");
    const nested = path.join(selected, "nested");
    const outside = path.join(root, "outside");
    await fsp.mkdir(nested, { recursive: true });
    await fsp.mkdir(outside);
    const slow = await startBackend(payload, { delayMs: 300 });
    const slowHandlers = localFiles.createLocalFileHandlers({
      net: fakeNet,
      shell: {},
      localBaseUrl: slow.url,
    });
    try {
      const pending = slowHandlers[localFiles.IPC.DOWNLOAD](fakeEvent, {
        transferId: "parent-race",
        origin: "local",
        body: {},
        rootPath: selected,
        destPath: path.join(nested, "file.bin"),
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await fsp.rename(nested, path.join(selected, "original"));
      await fsp.symlink(outside, nested, "junction");
      const result = await pending;
      expect(result.success).toBe(false);
      expect(await fsp.readdir(outside)).toEqual([]);
      expect((await fsp.readdir(selected)).sort()).toEqual([
        "nested",
        "original",
      ]);
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
        rootPath: root,
      });
      await new Promise((r) => setTimeout(r, 50));
      const second = await slowHandlers[localFiles.IPC.DOWNLOAD](fakeEvent, {
        transferId: "second",
        origin: "local",
        body: {},
        destPath: dest,
        rootPath: root,
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

  it("runs many downloads at once, cancels one without disturbing the others, and leaves no partials", async () => {
    const slow = await startBackend(payload, { delayMs: 250 });
    const slowHandlers = localFiles.createLocalFileHandlers({
      net: fakeNet,
      shell: {},
      localBaseUrl: slow.url,
    });
    try {
      const dests = Array.from({ length: 5 }, (_, i) =>
        path.join(root, "many", `part${i}`, `file${i}.bin`),
      );
      const pending = dests.map((dest, i) =>
        slowHandlers[localFiles.IPC.DOWNLOAD](fakeEvent, {
          transferId: `many-${i}`,
          origin: "local",
          body: { sessionId: "1", path: "/remote/file.bin" },
          destPath: dest,
          rootPath: root,
        }),
      );
      await new Promise((r) => setTimeout(r, 60));
      const cancelled = await slowHandlers[localFiles.IPC.CANCEL](
        fakeEvent,
        "many-2",
      );
      expect(cancelled.success).toBe(true);
      const results = await Promise.all(pending);
      results.forEach((r, i) => {
        if (i === 2) expect(r.success).toBe(false);
        else expect(r.success).toBe(true);
      });
      // Partials live in the selected root while in flight; none may remain.
      expect(await fsp.readdir(root)).toEqual(["many"]);
      for (const [i, dest] of dests.entries()) {
        if (i === 2) {
          expect(await fsp.readdir(path.dirname(dest))).toEqual([]);
        } else {
          expect((await fsp.readFile(dest)).equals(payload)).toBe(true);
          expect(await fsp.readdir(path.dirname(dest))).toEqual([
            `file${i}.bin`,
          ]);
        }
      }
    } finally {
      slow.close();
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
        rootPath: root,
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

// Simulates the Windows rename contract on top of the real filesystem:
// rename() onto a name that already exists fails instead of replacing it.
// Every rename is recorded so a test can prove the swap never relied on
// rename-over-existing.
function windowsLikeFs(
  overrides: Partial<PublishFs> = {},
): PublishFs & { renames: Array<[string, string]> } {
  const base = localFiles.defaultPublishFs;
  const renames: Array<[string, string]> = [];
  return {
    ...base,
    renames,
    rename: async (from, to) => {
      renames.push([from, to]);
      if (fs.existsSync(to)) {
        throw Object.assign(new Error(`EEXIST: file already exists, rename`), {
          code: "EEXIST",
        });
      }
      await base.rename(from, to);
    },
    ...overrides,
  };
}

describe("download destination containment", () => {
  const win = path.win32;
  const root = "C:\\Downloads\\selected";

  it("accepts ordinary nested destinations on Windows", () => {
    expect(
      localFiles.assertWithinRoot(root, "C:\\Downloads\\selected\\a.txt", win),
    ).toBe("C:\\Downloads\\selected\\a.txt");
    expect(
      localFiles.assertWithinRoot(
        root,
        "C:\\Downloads\\selected\\docs\\2026\\report.pdf",
        win,
      ),
    ).toBe("C:\\Downloads\\selected\\docs\\2026\\report.pdf");
    // case-insensitive drive/dir comparison, like the filesystem
    expect(
      localFiles.assertWithinRoot(root, "c:\\downloads\\SELECTED\\b.txt", win),
    ).toBe("c:\\downloads\\SELECTED\\b.txt");
  });

  it("rejects backslash traversal that normalises out of the root on Windows", () => {
    // The reviewer's reproduction: selected\..\outside.txt -> Downloads\outside.txt
    expect(() =>
      localFiles.assertWithinRoot(
        root,
        "C:\\Downloads\\selected\\..\\outside.txt",
        win,
      ),
    ).toThrow(/outside the selected folder/);
    expect(() =>
      localFiles.assertWithinRoot(
        root,
        "C:\\Downloads\\selected\\sub\\..\\..\\..\\x.txt",
        win,
      ),
    ).toThrow(/outside the selected folder/);
    // the root itself is not a valid file destination
    expect(() => localFiles.assertWithinRoot(root, root, win)).toThrow(
      /outside the selected folder/,
    );
  });

  it("rejects absolute, drive-qualified and UNC destinations on Windows", () => {
    for (const dest of [
      "C:\\Windows\\evil.dll",
      "D:\\Downloads\\selected\\x.txt",
      "\\\\server\\share\\x.txt",
      "C:\\Downloads\\selected-other\\x.txt",
    ]) {
      expect(() => localFiles.assertWithinRoot(root, dest, win)).toThrow(
        /outside the selected folder/,
      );
    }
  });

  it("requires a root and rejects POSIX traversal too", () => {
    expect(() => localFiles.assertWithinRoot("", "/tmp/x", path.posix)).toThrow(
      /download folder is required/,
    );
    expect(() =>
      localFiles.assertWithinRoot(
        "/home/max/dl",
        "/home/max/dl/../x",
        path.posix,
      ),
    ).toThrow(/outside the selected folder/);
    expect(
      localFiles.assertWithinRoot(
        "/home/max/dl",
        "/home/max/dl/..\\x",
        path.posix,
      ),
    ).toBe("/home/max/dl/..\\x");
  });

  it("refuses a download whose destination escapes the root, before any network or disk write", async () => {
    const payload = crypto.randomBytes(1024);
    const backend = await startBackend(payload);
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "termix-contain-"));
    const selected = path.join(tmp, "selected");
    await fsp.mkdir(selected);
    try {
      const handlers = localFiles.createLocalFileHandlers({
        net: fakeNet,
        shell: {},
        localBaseUrl: backend.url,
      });
      const requestsBefore = backend.seen.length;
      const result = await handlers[localFiles.IPC.DOWNLOAD](fakeEvent, {
        transferId: "escape-1",
        origin: "local",
        body: { sessionId: "1", path: "/remote/file.bin" },
        destPath: path.join(selected, "..", "outside.txt"),
        rootPath: selected,
      });
      expect(result.success).toBe(false);
      expect(result.code).toBe("EINVAL");
      expect(backend.seen.length).toBe(requestsBefore);
      expect(await fsp.readdir(tmp)).toEqual(["selected"]);

      // and the same for the directory skeleton
      const dir = await handlers[localFiles.IPC.ENSURE_DIR](
        fakeEvent,
        path.join(selected, "..", "escaped-dir"),
        selected,
      );
      expect(dir.success).toBe(false);
      expect(dir.code).toBe("EINVAL");
      expect(await fsp.readdir(tmp)).toEqual(["selected"]);

      // a missing root is refused as well
      const noRoot = await handlers[localFiles.IPC.DOWNLOAD](fakeEvent, {
        transferId: "escape-2",
        origin: "local",
        body: { sessionId: "1", path: "/remote/file.bin" },
        destPath: path.join(selected, "ok.bin"),
      });
      expect(noRoot.success).toBe(false);
      expect(noRoot.code).toBe("EINVAL");
      expect(await fsp.readdir(selected)).toEqual([]);
    } finally {
      backend.close();
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("local-files replace primitive (Windows-safe overwrite)", () => {
  let root: string;
  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "termix-replace-"));
  });
  afterEach(() => fsp.rm(root, { recursive: true, force: true }));

  const seed = async (name: string, existing: string, fresh: Buffer) => {
    const dest = path.join(root, name);
    const partial = `${dest}.t1.termix-part`;
    await fsp.writeFile(dest, existing);
    await fsp.writeFile(partial, fresh);
    return { dest, partial };
  };

  it("replaces an existing file without renaming onto an occupied name", async () => {
    const fresh = crypto.randomBytes(4096);
    const { dest, partial } = await seed("swap.bin", "original", fresh);
    const io = windowsLikeFs();

    await localFiles.publishDownload(partial, dest, true, "t1", io);

    expect((await fsp.readFile(dest)).equals(fresh)).toBe(true);
    expect(await fsp.readdir(root)).toEqual(["swap.bin"]);
    // Every rename targeted a name that was free at the time.
    expect(io.renames.length).toBeGreaterThan(0);
    for (const [, to] of io.renames) {
      expect(to === dest || to.endsWith(".termix-replaced")).toBe(true);
    }
  });

  it("restores the original byte-for-byte when publishing the new contents fails", async () => {
    const fresh = crypto.randomBytes(1024);
    const { dest, partial } = await seed("restore.bin", "original", fresh);
    const denied = () =>
      Promise.reject(
        Object.assign(new Error("EACCES: permission denied"), {
          code: "EACCES",
        }),
      );
    const io = windowsLikeFs({ link: denied, copyFileExcl: denied });

    await expect(
      localFiles.publishDownload(partial, dest, true, "t1", io),
    ).rejects.toMatchObject({ code: "EACCES" });

    expect(await fsp.readFile(dest, "utf8")).toBe("original");
    // Only the original and the caller-owned partial remain: no aside copy.
    expect((await fsp.readdir(root)).sort()).toEqual(
      ["restore.bin", "restore.bin.t1.termix-part"].sort(),
    );
  });

  it("reports EBUSY and touches nothing when the existing file cannot be moved aside (open on Windows)", async () => {
    const fresh = crypto.randomBytes(1024);
    const { dest, partial } = await seed("locked.bin", "original", fresh);
    const io = windowsLikeFs({
      rename: () =>
        Promise.reject(
          Object.assign(new Error("EPERM: operation not permitted"), {
            code: "EPERM",
          }),
        ),
    });

    await expect(
      localFiles.publishDownload(partial, dest, true, "t1", io),
    ).rejects.toMatchObject({ code: "EBUSY" });

    expect(await fsp.readFile(dest, "utf8")).toBe("original");
    expect((await fsp.readFile(partial)).equals(fresh)).toBe(true);
  });

  it("refuses to replace a folder with a file", async () => {
    const dest = path.join(root, "folder");
    await fsp.mkdir(dest);
    await fsp.writeFile(path.join(dest, "inner.txt"), "keep");
    const partial = `${dest}.t1.termix-part`;
    await fsp.writeFile(partial, "new");

    await expect(
      localFiles.publishDownload(partial, dest, true, "t1", windowsLikeFs()),
    ).rejects.toMatchObject({ code: "EISDIR" });
    expect(await fsp.readFile(path.join(dest, "inner.txt"), "utf8")).toBe(
      "keep",
    );
  });

  it("falls back to an exclusive publish when the file to replace has disappeared", async () => {
    const dest = path.join(root, "gone.bin");
    const partial = `${dest}.t1.termix-part`;
    await fsp.writeFile(partial, "new");

    await localFiles.publishDownload(
      partial,
      dest,
      true,
      "t1",
      windowsLikeFs(),
    );
    expect(await fsp.readFile(dest, "utf8")).toBe("new");
    expect(await fsp.readdir(root)).toEqual(["gone.bin"]);
  });

  it("works end to end through the download handler on a Windows-like filesystem", async () => {
    const payload = crypto.randomBytes(16 * 1024 + 3);
    const backend = await startBackend(payload);
    try {
      const io = windowsLikeFs();
      const handlers = localFiles.createLocalFileHandlers({
        net: fakeNet,
        shell: {},
        localBaseUrl: backend.url,
        publishFs: io,
      });
      const dest = path.join(root, "e2e.bin");
      await fsp.writeFile(dest, "original");

      const result = await handlers[localFiles.IPC.DOWNLOAD](fakeEvent, {
        transferId: "e2e-1",
        origin: "local",
        body: { sessionId: "1", path: "/remote/file.bin" },
        destPath: dest,
        rootPath: root,
        overwrite: true,
      });

      expect(result.success).toBe(true);
      expect((await fsp.readFile(dest)).equals(payload)).toBe(true);
      expect(await fsp.readdir(root)).toEqual(["e2e.bin"]);
      for (const [, to] of io.renames) {
        expect(to === dest || to.endsWith(".termix-replaced")).toBe(true);
      }
    } finally {
      backend.close();
    }
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

  it("puts the renderer's local token on the wire as a Bearer header (cookie no longer required)", async () => {
    const seen: http.IncomingHttpHeaders[] = [];
    const server = http.createServer((req, res) => {
      seen.push(req.headers);
      req.resume();
      req.on("end", () => {
        // The real backend answers 401 "Missing authentication token" when
        // neither cookie nor Bearer header is present.
        if (!req.headers.authorization) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: "Missing authentication token" }));
          return;
        }
        res.end(JSON.stringify({ message: "ok" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "termix-upload-"));
    const localPath = path.join(root, "small.txt");
    await fsp.writeFile(localPath, "hello");
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1MSJ9.c2ln";
    try {
      const handlers = localFiles.createLocalFileHandlers({
        net: fakeNet,
        shell: {},
        localBaseUrl: `http://127.0.0.1:${port}/ssh/file_manager`,
      });
      const withoutToken = await handlers[localFiles.IPC.UPLOAD](fakeEvent, {
        transferId: "up-auth-0",
        origin: "local",
        fields: { sessionId: "42", path: "/home/ubuntu" },
        localPath,
        fileName: "small.txt",
      });
      expect(withoutToken.success).toBe(false);
      expect(withoutToken.error).toMatch(/Missing authentication token/);

      const withToken = await handlers[localFiles.IPC.UPLOAD](fakeEvent, {
        transferId: "up-auth-1",
        origin: "local",
        authToken: jwt,
        fields: { sessionId: "42", path: "/home/ubuntu" },
        localPath,
        fileName: "small.txt",
        headers: { Authorization: "Bearer leaked" },
      });
      expect(withToken.success).toBe(true);
      expect(seen[1]?.authorization).toBe(`Bearer ${jwt}`);
      expect(seen[1]?.["x-electron-app"]).toBe("true");

      const malformed = await handlers[localFiles.IPC.UPLOAD](fakeEvent, {
        transferId: "up-auth-2",
        origin: "local",
        authToken: "not a token\r\nX-Injected: 1",
        fields: { sessionId: "42", path: "/home/ubuntu" },
        localPath,
        fileName: "small.txt",
      });
      expect(malformed.success).toBe(false);
      expect(malformed.error).toMatch(/Invalid auth token/);
      expect(seen.length).toBe(2); // the malformed one never reached the network
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps every body intact when several uploads run at once and cancels only the requested one", async () => {
    const Busboy = require("busboy") as (opts: {
      headers: http.IncomingHttpHeaders;
    }) => NodeJS.EventEmitter & NodeJS.WritableStream;
    const received = new Map<string, string>(); // fileName -> sha256
    let inFlight = 0;
    let peak = 0;
    const server = http.createServer((req, res) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const bb = Busboy({ headers: req.headers });
      let name = "";
      const hash = crypto.createHash("sha256");
      bb.on(
        "file",
        (
          _n: string,
          stream: NodeJS.ReadableStream,
          info: { filename: string },
        ) => {
          name = info.filename;
          stream.on("data", (d: Buffer) => hash.update(d));
        },
      );
      bb.on("close", () => {
        // Hold the response a little so requests genuinely overlap.
        setTimeout(() => {
          inFlight -= 1;
          received.set(name, hash.digest("hex"));
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ message: "ok" }));
        }, 120);
      });
      req.on("aborted", () => {
        inFlight -= 1;
      });
      req.pipe(bb);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "termix-par-up-"));
    const files = await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        const payload = crypto.randomBytes(256 * 1024 + i);
        const localPath = path.join(root, `f${i}.bin`);
        await fsp.writeFile(localPath, payload);
        return {
          i,
          localPath,
          sha: crypto.createHash("sha256").update(payload).digest("hex"),
        };
      }),
    );
    try {
      const handlers = localFiles.createLocalFileHandlers({
        net: fakeNet,
        shell: {},
        localBaseUrl: `http://127.0.0.1:${port}/ssh/file_manager`,
      });
      const results = await Promise.all(
        files.map((f) =>
          handlers[localFiles.IPC.UPLOAD](fakeEvent, {
            transferId: `par-up-${f.i}`,
            origin: "local",
            fields: { sessionId: "1", path: "/remote" },
            localPath: f.localPath,
            fileName: `f${f.i}.bin`,
          }),
        ),
      );
      expect(results.every((r) => r.success)).toBe(true);
      expect(peak).toBeGreaterThan(1);
      for (const f of files) expect(received.get(`f${f.i}.bin`)).toBe(f.sha);
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
