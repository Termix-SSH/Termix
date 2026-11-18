/**
 * The desktop starts each plugin backend on the app's pinned Node inside the
 * OS sandbox helper, only when the request passes the same checks the Docker
 * launcher makes, and relays its stdio frames without reading them.
 */
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import * as policy from "../src/backend/plugins/sandbox/launcher/policy.js";
import * as frames from "../src/backend/plugins/sandbox/frames.js";

const require = createRequire(import.meta.url);
const { createPluginSandboxHost } = require("../electron/plugin-sandbox.cjs");

const backendDir = path.resolve("/app/dist/backend/backend");
const dataRoot = path.resolve("/data");
const childDir = path.join(backendDir, "plugins", "sandbox", "child");
const harden = path.join(childDir, "harden.js");
const runtime = {
  node: path.resolve("/app/plugin-runtime/node"),
  jail: path.resolve("/app/plugin-runtime/termix-plugin-jail"),
};

class FakePort extends EventEmitter {
  posted: unknown[] = [];
  other?: FakePort;
  closed = false;
  postMessage(data: unknown) {
    this.posted.push(data);
  }
  start() {}
  close() {
    this.closed = true;
  }
}

function fakeChild() {
  const stdinWrites: Buffer[] = [];
  const stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  return Object.assign(new EventEmitter(), {
    pid: 4321,
    stdin: Object.assign(new EventEmitter(), {
      write: (chunk: Buffer) => stdinWrites.push(chunk),
    }),
    stdout: new EventEmitter(),
    stderr,
    kill: vi.fn(),
    stdinWrites,
  });
}

function setup(options: Record<string, unknown> = {}) {
  const spawns: Array<{
    file: string;
    args: string[];
    options: Record<string, unknown>;
    child: ReturnType<typeof fakeChild>;
  }> = [];
  const ports: FakePort[] = [];
  const posted: Array<{
    message: Record<string, unknown>;
    transfer: unknown[];
  }> = [];
  class MessageChannelMain {
    port1 = new FakePort();
    port2 = new FakePort();
    constructor() {
      ports.push(this.port1, this.port2);
    }
  }
  const backend = {
    postMessage: (message: Record<string, unknown>, transfer: unknown[]) =>
      posted.push({ message, transfer }),
  };
  const host = createPluginSandboxHost({
    MessageChannelMain,
    backendDir,
    dataRoot,
    platform: "linux",
    env: { SystemRoot: "C:\\Windows", SECRET: "x" },
    getRuntime: () => runtime,
    spawnProcess: (
      file: string,
      args: string[],
      opts: Record<string, unknown>,
    ) => {
      const child = fakeChild();
      spawns.push({ file, args, options: opts, child });
      setImmediate(() => child.emit("spawn"));
      return child;
    },
    loadPolicy: () => policy,
    loadFrames: () => frames,
    ...options,
  });
  return { host, backend, spawns, posted, ports };
}

function spawnMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: "tmx-sandbox",
    op: "spawn",
    id: "r1",
    pluginId: "docker",
    dataDir: path.join(dataRoot, "plugin-data", "docker"),
    env: { NODE_ENV: "production", TERMIX_SANDBOX_PLUGIN: "docker" },
    execArgv: [
      "--permission",
      `--allow-fs-read=${path.resolve("/app/dist/plugins/docker")}`,
      "--max-old-space-size=256",
      `--import=${pathToFileURL(harden).href}`,
    ],
    ...overrides,
  };
}

const settle = () => new Promise((r) => setImmediate(r));

describe("desktop plugin sandbox host", () => {
  it("starts the pinned Node inside the helper with the checked flags", async () => {
    const { host, backend, spawns, posted, ports } = setup();
    vi.spyOn(require("fs"), "mkdirSync").mockImplementation(() => undefined);
    expect(host.handle(spawnMessage(), backend)).toBe(true);
    await settle();
    const [{ file, args, options }] = spawns;
    expect(file).toBe(runtime.jail);
    const split = args.indexOf("--");
    const jailPolicy = JSON.parse(args[split - 1]);
    expect(jailPolicy).toMatchObject({
      name: "docker",
      net: false,
      childProcess: false,
      addons: false,
      write: [],
    });
    expect(jailPolicy.read).toContain(path.resolve("/app/dist/plugins/docker"));
    expect(args[split + 1]).toBe(runtime.node);
    expect(args).toContain("--permission");
    expect(args.slice(-2)).toEqual([
      path.join(childDir, "runtime.js"),
      frames.STDIO_FLAG,
    ]);
    expect(options.env).toEqual({
      NODE_ENV: "production",
      TERMIX_SANDBOX_PLUGIN: "docker",
    });
    expect(options.cwd).toBe(path.join(dataRoot, "plugin-data", "docker"));
    expect(posted[0].message).toMatchObject({
      op: "spawned",
      id: "r1",
      pid: 4321,
    });
    expect(posted[0].transfer).toEqual([ports[1]]);
  });

  it("moves frames between the port and the child's stdio unread", async () => {
    const { host, backend, spawns, ports } = setup();
    vi.spyOn(require("fs"), "mkdirSync").mockImplementation(() => undefined);
    host.handle(spawnMessage(), backend);
    await settle();
    const { child } = spawns[0];
    ports[0].emit("message", { data: new Uint8Array([1, 2, 3]) });
    expect(child.stdinWrites[0]).toEqual(Buffer.from([0, 0, 0, 3, 1, 2, 3]));
    const frame = frames.encodeFrame(Buffer.from("hello"));
    child.stdout.emit("data", frame.subarray(0, 3));
    child.stdout.emit("data", frame.subarray(3));
    expect(ports[0].posted).toEqual([Buffer.from("hello")]);
  });

  it("stops a child that sends a frame over the limit", async () => {
    const { host, backend, spawns } = setup();
    vi.spyOn(require("fs"), "mkdirSync").mockImplementation(() => undefined);
    host.handle(spawnMessage(), backend);
    await settle();
    const head = Buffer.alloc(4);
    head.writeUInt32BE(frames.MAX_FRAME + 1, 0);
    spawns[0].child.stdout.emit("data", head);
    expect(spawns[0].child.kill).toHaveBeenCalled();
  });

  it("refuses to start anything when the runtime is missing or changed", () => {
    const { host, backend, spawns, posted } = setup({
      getRuntime: () => ({ error: "no fenced plugin runtime" }),
    });
    host.handle(spawnMessage(), backend);
    expect(spawns).toHaveLength(0);
    expect(posted[0].message).toMatchObject({
      op: "error",
      message: "no fenced plugin runtime",
    });
  });

  it("adds what Windows needs and nothing from main's own env", async () => {
    const { host, backend, spawns } = setup({ platform: "win32" });
    vi.spyOn(require("fs"), "mkdirSync").mockImplementation(() => undefined);
    host.handle(spawnMessage(), backend);
    await settle();
    expect(spawns[0].args).toContain("--preserve-symlinks");
    expect(spawns[0].options.env).toEqual({
      NODE_ENV: "production",
      TERMIX_SANDBOX_PLUGIN: "docker",
      SystemRoot: "C:\\Windows",
    });
  });

  it("skips the Seatbelt profile only in the App Store build", async () => {
    const { host, backend, spawns } = setup({ mas: true });
    vi.spyOn(require("fs"), "mkdirSync").mockImplementation(() => undefined);
    host.handle(spawnMessage(), backend);
    await settle();
    expect(spawns[0].args[0]).toBe("--no-seatbelt");
  });

  it("refuses a core secret or a Node option in the env", () => {
    const { host, backend, spawns } = setup();
    for (const extra of [{ JWT_SECRET: "x" }, { NODE_OPTIONS: "--inspect" }]) {
      host.handle(
        spawnMessage({
          id: Math.random().toString(),
          env: {
            NODE_ENV: "production",
            TERMIX_SANDBOX_PLUGIN: "docker",
            ...extra,
          },
        }),
        backend,
      );
    }
    expect(spawns).toHaveLength(0);
  });

  it("refuses a request the launcher policy refuses", () => {
    const { host, backend, spawns, posted } = setup();
    host.handle(spawnMessage({ execArgv: ["--inspect"] }), backend);
    expect(spawns).toHaveLength(0);
    expect(posted[0].message).toMatchObject({ op: "error", id: "r1" });
  });

  it("ignores messages that are not for it", () => {
    const { host, backend } = setup();
    expect(host.handle({ type: "backend-request" }, backend)).toBe(false);
  });

  it("stays out of the main window's IPC: only the backend can ask", async () => {
    const { readFileSync } = await import("node:fs");
    const main = readFileSync("electron/main.cjs", "utf8");
    expect(main).toContain("pluginSandbox?.handle(msg, spawned)");
    expect(main).not.toMatch(/ipcMain\.\w+\([^)]*tmx-sandbox/);
  });
});
