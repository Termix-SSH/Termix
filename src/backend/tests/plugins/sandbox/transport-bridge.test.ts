/**
 * ctx.ssh.prepare, openTransport, jumpChain, forwardOut and desktop.local in
 * a plugin process: the host key check stays in core, the stream core opens
 * only carries bytes once the far end greeted as an SSH server, and the
 * desktop streams move both ways.
 */
import net from "node:net";
import { Duplex, PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const granted = vi.hoisted(() => ({ credentials: false }));
vi.mock("../../../plugins/permissions.js", () => ({
  hasCapability: async (_id: string, capability: string) =>
    capability === "credentials:read" ? granted.credentials : true,
}));

import { explainHostKeyRefusal } from "../../../hosts/host-key-policy.js";
import { PluginBridge } from "../../../plugins/sandbox/bridge.js";
import {
  Endpoint,
  type StreamPort,
  type Transport,
  type Wire,
} from "../../../plugins/sandbox/rpc.js";
import { SandboxTokenStore } from "../../../plugins/sandbox/tokens.js";
import {
  EARLY_WRITE_LIMIT,
  GREETING_LIMIT,
  greetingIndex,
  plainConfig,
  refusalFromStandIn,
  standInClient,
} from "../../../plugins/sandbox/transport-bridge.js";

type AnyFn = (...args: unknown[]) => unknown;

const GOOD_KEY = Buffer.from("good-key");

function setup(ctxExtra: Record<string, unknown> = {}) {
  const hostHandlers: Array<(m: Wire) => void> = [];
  const childHandlers: Array<(m: Wire) => void> = [];
  const hostTransport: Transport = {
    send: (m) => {
      const copy = structuredClone(m);
      setImmediate(() => childHandlers.forEach((h) => h(copy)));
    },
    onMessage: (h) => hostHandlers.push(h),
  };
  const childTransport: Transport = {
    send: (m) => {
      const copy = structuredClone(m);
      setImmediate(() => hostHandlers.forEach((h) => h(copy)));
    },
    onMessage: (h) => childHandlers.push(h),
  };
  const seen: { prepare?: Record<string, unknown> } = {};
  const jumpClient = Object.assign(new PassThrough(), {
    end: vi.fn(),
    forwardOut: vi.fn(),
  });
  const ctx = {
    pluginId: "term",
    log: { info: () => {}, error: () => {} },
    ssh: {
      prepare: vi.fn(
        async (_host: unknown, options: Record<string, unknown>) => {
          seen.prepare = options;
          return {
            config: {
              host: "127.0.0.1",
              port: 22,
              username: "me",
              password: "pw",
              privateKey: Buffer.from("KEY"),
              authHandler: ["publickey", "password"],
              algorithms: { kex: ["curve25519-sha256"] },
              hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
                if (key.equals(GOOD_KEY)) return verify(true);
                explainHostKeyRefusal(
                  options.client as never,
                  "HOST_KEY_CHANGED",
                );
                verify(false);
              },
              debug: () => {},
            },
            outcome: { status: "ready" },
            authType: "password",
            onBanner: async (banner: string) => ({ shown: banner }),
          };
        },
      ),
      openTransport: vi.fn(
        async (
          _host: unknown,
          config: Record<string, unknown>,
          options: { prompt?: { ask: AnyFn } },
        ) => {
          if (config.host === "jump.example") {
            await options.prompt?.ask({ kind: "totp", prompt: "Code" });
            config.sock = (ctxExtra.jumpSock as Duplex) ?? new PassThrough();
            return { jumpClient, via: "jump" };
          }
          return { jumpClient: null, via: "direct" };
        },
      ),
      jumpChain: vi.fn(async () => ({
        client: jumpClient,
        host: { id: 3, ip: "10.0.0.3", password: "hunter2" },
        dispose: vi.fn(),
      })),
      connect: vi.fn(async () => ({
        client: jumpClient,
        host: { id: 1 },
        dispose: vi.fn(),
      })),
    },
    ...ctxExtra,
  };
  const tokens = new SandboxTokenStore();
  const bridge = new PluginBridge(hostTransport, {
    manifest: { id: "term", capabilities: [], sandbox: {} } as never,
    ctx: ctx as never,
    tokens,
    dialect: "sqlite",
  });
  const child = new Endpoint(childTransport, {
    side: "c",
    outboundToken: () => undefined,
    inbound: (_token, run) => run(),
  });
  return { bridge, child, ctx, seen, jumpClient };
}

const servers: net.Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  granted.credentials = false;
});

/** A TCP server; `greet` decides what it sends first and when. */
async function server(
  onSocket: (socket: net.Socket, received: Buffer[]) => void,
): Promise<number> {
  const s = net.createServer((socket) => {
    const received: Buffer[] = [];
    socket.on("data", (chunk) => received.push(chunk));
    socket.on("error", () => {});
    onSocket(socket, received);
  });
  servers.push(s);
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  return (s.address() as net.AddressInfo).port;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await wait(10);
  }
};

describe("helpers", () => {
  it("finds the greeting at the start or after other lines", () => {
    expect(greetingIndex(Buffer.from("SSH-2.0-x\r\n"))).toBe(0);
    expect(greetingIndex(Buffer.from("hello\r\nSSH-2.0-x\r\n"))).toBe(7);
    expect(greetingIndex(Buffer.from("HTTP/1.1 200 OK\r\n"))).toBe(-1);
  });

  it("copies only data from a config", () => {
    const copy = plainConfig({
      host: "h",
      port: 2,
      key: Buffer.from("k"),
      list: ["a", () => 1],
      nested: { ok: true, fn: () => 1 },
      hostVerifier: () => true,
      sock: new PassThrough(),
    }) as Record<string, unknown>;
    expect(copy).toEqual({
      host: "h",
      port: 2,
      key: Buffer.from("k"),
      list: ["a"],
      nested: { ok: true },
    });
  });

  it("reads the host key policy's reason back from the stand-in", () => {
    const client = standInClient();
    expect(refusalFromStandIn(client).code).toBeUndefined();
    explainHostKeyRefusal(client as never, "HOST_KEY_UNVERIFIED");
    expect(refusalFromStandIn(client)).toMatchObject({
      code: "HOST_KEY_UNVERIFIED",
      message: expect.stringContaining("not trusted"),
    });
  });
});

describe("ssh.prepare", () => {
  it("builds the config against a stand-in client and keeps the verifier", async () => {
    const { child, seen } = setup();
    const result = (await child.call("ssh.prepare", [
      1,
      { purpose: "terminal", interactive: true, hostKeySocket: "h999" },
    ])) as {
      prepared: string;
      config: Record<string, unknown>;
      onBanner: AnyFn;
    };
    expect(
      (seen.prepare!.client as { termixSandboxClient: boolean })
        .termixSandboxClient,
    ).toBe(true);
    // An id that names none of the plugin's sockets gives no prompt socket.
    expect(seen.prepare!.hostKeySocket).toBeNull();
    expect(result.config).toMatchObject({
      host: "127.0.0.1",
      password: "pw",
      authHandler: ["publickey", "password"],
    });
    expect(result.config.hostVerifier).toBeUndefined();
    expect(result.config.debug).toBeUndefined();
    expect(Buffer.from(result.config.privateKey as Uint8Array).toString()).toBe(
      "KEY",
    );
    expect(await result.onBanner("hi")).toEqual({ shown: "hi" });
  });

  it("checks each key in core and says why one was refused", async () => {
    const { child } = setup();
    const { prepared } = (await child.call("ssh.prepare", [1, {}])) as {
      prepared: string;
    };
    expect(await child.call("ssh.verifyHostKey", [prepared, GOOD_KEY])).toEqual(
      { valid: true },
    );
    expect(
      await child.call("ssh.verifyHostKey", [prepared, Buffer.from("bad")]),
    ).toMatchObject({
      valid: false,
      code: "HOST_KEY_CHANGED",
      message: expect.stringContaining("changed"),
    });
    expect(await child.call("ssh.verifyHostKey", [prepared, "text"])).toEqual(
      expect.objectContaining({ valid: false }),
    );
    await expect(
      child.call("ssh.verifyHostKey", ["client1", GOOD_KEY]),
    ).rejects.toMatchObject({ code: "SANDBOX_HANDLE" });
  });
});

describe("ssh.openTransport", () => {
  it("holds the plugin's bytes until the host greets as an SSH server", async () => {
    let early: Buffer[] = [];
    let after: Buffer[] = [];
    const port = await server((socket, received) => {
      setTimeout(() => {
        early = [...received];
        socket.write("SSH-2.0-Fake\r\n");
        setTimeout(() => {
          after = [...received];
        }, 100);
      }, 100);
    });
    const { child } = setup();
    const result = (await child.call("ssh.openTransport", [
      1,
      { host: "127.0.0.1", port },
      {},
    ])) as { via: string; sock: StreamPort; jumpClient: unknown };
    expect(result.via).toBe("direct");
    expect(result.jumpClient).toBeNull();
    const got: Buffer[] = [];
    result.sock.on("data", (chunk: Buffer) => got.push(chunk));
    result.sock.write(Buffer.from("SSH-2.0-Plugin\r\n"));
    await until(() => after.length > 0);
    expect(Buffer.concat(early).length).toBe(0);
    expect(Buffer.concat(after).toString()).toBe("SSH-2.0-Plugin\r\n");
    expect(Buffer.concat(got).toString()).toBe("SSH-2.0-Fake\r\n");
  });

  it("ends the stream when the far end is not an SSH server", async () => {
    let received = 0;
    const port = await server((socket, chunks) => {
      socket.write(Buffer.alloc(GREETING_LIMIT + 10, 0x41));
      setTimeout(() => {
        received = chunks.reduce((n, c) => n + c.length, 0);
      }, 100);
    });
    const { child } = setup();
    const result = (await child.call("ssh.openTransport", [
      1,
      { host: "127.0.0.1", port },
      {},
    ])) as { sock: StreamPort };
    const errors: string[] = [];
    const got: Buffer[] = [];
    result.sock.on("error", (e: Error) => errors.push(e.message));
    result.sock.on("data", (chunk: Buffer) => got.push(chunk));
    result.sock.write(Buffer.from("GET / HTTP/1.1\r\n\r\n"));
    await until(() => errors.length > 0);
    expect(errors[0]).toMatch(/did not answer as an SSH server/);
    expect(got).toHaveLength(0);
    await wait(150);
    expect(received).toBe(0);
  });

  it("caps what the plugin writes before the greeting", async () => {
    const port = await server(() => {});
    const { child } = setup();
    const result = (await child.call("ssh.openTransport", [
      1,
      { host: "127.0.0.1", port },
      {},
    ])) as { sock: StreamPort };
    const errors: string[] = [];
    result.sock.on("error", (e: Error) => errors.push(e.message));
    for (let i = 0; i < 4; i++) {
      result.sock.write(Buffer.alloc(EARLY_WRITE_LIMIT / 2));
    }
    await until(() => errors.length > 0);
    expect(errors[0]).toMatch(/before the host greeted/);
  });

  it("closes core's socket when the plugin closes its end", async () => {
    let closed = false;
    const port = await server((socket) => {
      socket.write("SSH-2.0-Fake\r\n");
      socket.on("close", () => {
        closed = true;
      });
    });
    const { child } = setup();
    const result = (await child.call("ssh.openTransport", [
      1,
      { host: "127.0.0.1", port },
      {},
    ])) as { sock: StreamPort };
    await wait(50);
    child.notify("stream.close", [result.sock.sid]);
    await until(() => closed);
  });

  it("goes through the jump route core picked and asks the plugin's prompt", async () => {
    const jumpSock = new PassThrough();
    const { child, ctx } = setup({ jumpSock });
    const asked: unknown[] = [];
    const result = (await child.call("ssh.openTransport", [
      1,
      { host: "jump.example", port: 22 },
      {
        prompt: {
          ask: async (request: unknown) => {
            asked.push(request);
            return "123456";
          },
        },
      },
    ])) as { via: string; jumpClient: { $ssh: string } };
    expect(result.via).toBe("jump");
    expect(result.jumpClient.$ssh).toMatch(/^client/);
    expect(asked).toEqual([{ kind: "totp", prompt: "Code" }]);
    expect(ctx.ssh.openTransport).toHaveBeenCalled();
  });

  it("keeps a stream the plugin brought for a direct connection", async () => {
    const { child } = setup();
    const result = (await child.call("ssh.openTransport", [
      1,
      { host: "127.0.0.1", port: 1 },
      { ownSock: true },
    ])) as { sock: unknown };
    expect(result.sock).toBeNull();
  });

  it("refuses a config without a host", async () => {
    const { child } = setup();
    await expect(
      child.call("ssh.openTransport", [1, {}, {}]),
    ).rejects.toMatchObject({ code: "SANDBOX_VALUE" });
  });
});

describe("jump chains and forwards", () => {
  it("hands out a client handle with secrets stripped", async () => {
    const { child } = setup();
    const result = (await child.call("ssh.jumpChain", [
      [{ hostId: 3 }],
      {},
    ])) as { client: { $ssh: string }; host: object };
    expect(result.client.$ssh).toMatch(/^client/);
    expect(JSON.stringify(result.host)).not.toContain("hunter2");
  });

  it("forwards a channel as a stream both ways", async () => {
    const { child, jumpClient } = setup();
    const far = new PassThrough();
    const near = new PassThrough();
    const channel = Duplex.from({ readable: far, writable: near });
    jumpClient.forwardOut.mockImplementation(
      (_a: string, _b: number, _c: string, _d: number, cb: AnyFn) =>
        cb(undefined, channel),
    );
    const { client } = (await child.call("ssh.connect", [1, {}])) as {
      client: { $ssh: string };
    };
    const port = (await child.call("ssh.forwardOut", [
      client.$ssh,
      "127.0.0.1",
      0,
      "10.0.0.9",
      3389,
    ])) as StreamPort;
    const got: Buffer[] = [];
    port.on("data", (c: Buffer) => got.push(c));
    far.write("from host");
    const sent: Buffer[] = [];
    near.on("data", (c: Buffer) => sent.push(c));
    port.write(Buffer.from("from plugin"));
    await until(() => got.length > 0 && sent.length > 0);
    expect(Buffer.concat(got).toString()).toBe("from host");
    expect(Buffer.concat(sent).toString()).toBe("from plugin");
  });
});

describe("desktop.local", () => {
  function desktopCtx() {
    const written: Buffer[] = [];
    const sink = new PassThrough();
    sink.on("data", (c: Buffer) => written.push(c));
    const publish = vi.fn(async () => "/home/me/file.txt");
    let onData: ((d: string) => void) | null = null;
    let onExit: ((code: number) => void) | null = null;
    const typed: string[] = [];
    const local = {
      available: vi.fn(async () => true),
      fs: {
        list: vi.fn(async (dir: string) => ({
          path: dir,
          parent: null,
          entries: [],
        })),
        openRead: vi.fn(async () => ({
          stream: Readable.from([Buffer.from("hello "), Buffer.from("file")]),
          size: 10,
        })),
        openDownload: vi.fn(async () => ({
          path: "/home/me/file.txt.part",
          stream: sink,
          publish,
          abort: vi.fn(async () => {}),
        })),
      },
      pty: {
        spawn: vi.fn(async () => ({
          pid: 7,
          shell: "bash",
          write: (d: string) => typed.push(d),
          resize: vi.fn(),
          kill: vi.fn(() => onExit?.(0)),
          onData: (fn: (d: string) => void) => {
            onData = fn;
            return () => {
              onData = null;
            };
          },
          onExit: (fn: (code: number) => void) => {
            onExit = fn;
            return () => {
              onExit = null;
            };
          },
        })),
      },
      pluginFetch: vi.fn(async () => ({
        status: 200,
        ok: true,
        headers: new Headers({ "content-type": "text/plain" }),
        body: Readable.from([Buffer.from("routed")]),
      })),
    };
    return {
      local,
      written,
      publish,
      typed,
      emit: (d: string) => onData?.(d),
    };
  }

  it("serves plain calls through the generic handler", async () => {
    const d = desktopCtx();
    const { child } = setup({ desktop: { local: d.local } });
    expect(
      await child.call("ctx.desktop.local.fs.list", ["/home/me"]),
    ).toMatchObject({ path: "/home/me" });
    expect(await child.call("ctx.desktop.local.available", [])).toBe(true);
  });

  it("streams a local file to the plugin", async () => {
    const d = desktopCtx();
    const { child } = setup({ desktop: { local: d.local } });
    const result = (await child.call("desktop.local.fs.openRead", [
      "/home/me/a.txt",
    ])) as { stream: StreamPort; size: number };
    const parts: Buffer[] = [];
    for await (const chunk of result.stream) parts.push(chunk as Buffer);
    expect(Buffer.concat(parts).toString()).toBe("hello file");
    expect(result.size).toBe(10);
  });

  it("publishes a download only after every byte is written", async () => {
    const d = desktopCtx();
    const { child } = setup({ desktop: { local: d.local } });
    const port = child.openStream();
    const result = (await child.call("desktop.local.fs.openDownload", [
      { rootPath: "/home/me", destPath: "file.txt", transferId: "t1" },
      port,
    ])) as { path: string; publish: AnyFn };
    port.write(Buffer.from("abc"));
    port.write(Buffer.from("def"));
    port.end();
    expect(await result.publish()).toBe("/home/me/file.txt");
    expect(Buffer.concat(d.written).toString()).toBe("abcdef");
    expect(d.publish).toHaveBeenCalled();
  });

  it("runs a local shell over a stream", async () => {
    const d = desktopCtx();
    const { child } = setup({ desktop: { local: d.local } });
    const result = (await child.call("desktop.local.pty.spawn", [
      { cols: 80, rows: 24 },
    ])) as { pid: number; stream: StreamPort; kill: AnyFn };
    expect(result.pid).toBe(7);
    const out: string[] = [];
    let exit: unknown = null;
    result.stream.on("data", (c: { d: string }) => out.push(c.d));
    result.stream.on("remote-end", (meta: unknown) => {
      exit = meta;
    });
    result.stream.write({ d: "ls\r", b: false });
    await wait(30);
    d.emit("file1\r\n");
    await until(() => out.length > 0 && d.typed.length > 0);
    expect(out).toEqual(["file1\r\n"]);
    expect(d.typed).toEqual(["ls\r"]);
    await result.kill();
    await until(() => exit !== null);
    expect(exit).toEqual({ code: 0 });
  });

  it("calls the plugin's own route and streams the answer", async () => {
    const d = desktopCtx();
    const { child } = setup({ desktop: { local: d.local } });
    const result = (await child.call("desktop.local.pluginFetch", [
      "local",
      "/files",
      { method: "POST", headers: { a: "b", bad: 1 }, body: "x" },
    ])) as {
      status: number;
      headers: Record<string, string>;
      body: StreamPort;
    };
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("text/plain");
    const parts: Buffer[] = [];
    for await (const chunk of result.body) parts.push(chunk as Buffer);
    expect(Buffer.concat(parts).toString()).toBe("routed");
    expect(d.local.pluginFetch).toHaveBeenCalledWith("local", "/files", {
      method: "POST",
      headers: { a: "b" },
      body: "x",
    });
  });
});

describe("ssh.transports.provide", () => {
  it("asks the plugin about each host and carries its stream as a port", async () => {
    let registered: {
      claims: (id: number, host?: unknown) => Promise<boolean>;
      open: (host: unknown) => Promise<Duplex>;
    } | null = null;
    const dispose = vi.fn();
    const { child } = setup({
      ssh: {
        transports: {
          provide: vi.fn((provider: typeof registered) => {
            registered = provider;
            return dispose;
          }),
        },
      },
    });
    const pluginSide = child.openStream();
    const remove = (await child.call("ssh.transports.provide", [
      {
        claims: (id: number) => (id === 7 ? true : "yes"),
        open: async () => pluginSide,
      },
    ])) as AnyFn;
    expect(await registered!.claims(7, { id: 7 })).toBe(true);
    // A truthy answer that is not true never claims a host.
    expect(await registered!.claims(8, { id: 8 })).toBe(false);
    const socket = await registered!.open({ id: 7, ip: "10.0.0.7", port: 22 });
    const got: Buffer[] = [];
    pluginSide.on("data", (c: Buffer) => got.push(c));
    socket.write(Buffer.from("SSH-2.0-core\r\n"));
    await until(() => got.length > 0);
    expect(Buffer.concat(got).toString()).toBe("SSH-2.0-core\r\n");
    await remove();
    expect(dispose).toHaveBeenCalled();
  });
});
