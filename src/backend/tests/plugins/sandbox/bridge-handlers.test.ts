/**
 * The bridge's own handlers: routes, permission checks, the database guard,
 * SSH and SFTP handles, services, audit export and logging. Each one is a
 * place a sandboxed plugin could try to reach past what it was granted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const granted = vi.hoisted(() => ({ credentials: false }));
vi.mock("../../../plugins/permissions.js", () => ({
  hasCapability: async (_id: string, capability: string) =>
    capability === "credentials:read" ? granted.credentials : true,
}));

const sql = vi.hoisted(() => ({
  run: vi.fn(async () => [{ ok: 1 }]),
  batch: vi.fn(async () => [[{ ok: 1 }]]),
}));
vi.mock("../../../plugins/sandbox/db-exec.js", () => ({
  runPluginSql: sql.run,
  runPluginSqlBatch: sql.batch,
}));

import { EventEmitter } from "events";
import { runAsActor } from "../../../plugins/actor.js";
import { PluginBridge, sandboxLog } from "../../../plugins/sandbox/bridge.js";
import type { Transport, Wire } from "../../../plugins/sandbox/rpc.js";
import { SandboxTokenStore } from "../../../plugins/sandbox/tokens.js";

type AnyFn = (...args: unknown[]) => unknown;
type Reply = Wire & { v?: unknown; e?: { code?: string; message: string } };

function harness() {
  const pluginId = "docker";
  const tokens = new SandboxTokenStore();
  const toHost: Array<(m: Wire) => void> = [];
  const replies: Wire[] = [];
  const transport: Transport = {
    send: (m) => replies.push(m),
    onMessage: (h) => toHost.push(h),
  };
  const routes: Array<[string, unknown]> = [];
  const router = {
    get: (path: unknown) => routes.push(["get", path]),
    post: (path: unknown) => routes.push(["post", path]),
    use: (path: unknown) => routes.push(["use", path]),
  };
  const sshClient = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    exec: vi.fn(),
    sftp: (cb: (err: unknown, s: unknown) => void) =>
      cb(null, {
        end: vi.fn(),
        stat: (_p: string, done: (e: unknown, v: unknown) => void) =>
          done(null, {
            size: 5,
            mode: 33188,
            mtime: 1,
            atime: 1,
            uid: 0,
            gid: 0,
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
          }),
      }),
  });
  const service = {
    list: vi.fn(async (...args: unknown[]) => ["listed", ...args]),
    asUser: vi.fn((userId: string) => ({ who: () => userId })),
  };
  async function* batches() {
    yield [{ id: 1 }];
    yield [{ id: 2 }];
  }
  const logs: string[] = [];
  const ctx = {
    pluginId,
    http: { router: vi.fn(() => router) },
    ws: { route: vi.fn(), upgrade: vi.fn() },
    rbac: {
      require: (permission: string) => {
        if (permission === "undeclared") throw new Error("not declared");
        return (
          req: { userId?: string },
          res: { status: (c: number) => { json: (b: unknown) => void } },
          next: () => void,
        ) =>
          req.userId === "alice"
            ? next()
            : res.status(403).json({ error: "no" });
      },
    },
    db: {
      define: vi.fn(async () => ({ fake: "table" })),
      client: vi.fn(async () => ({})),
      refs: vi.fn(async () => ({})),
    },
    ssh: {
      connect: vi.fn(async () => ({
        client: sshClient,
        host: { id: 1, ip: "10.0.0.1", password: "hunter2" },
        dispose: vi.fn(),
      })),
      withConnection: vi.fn(
        async (_h: unknown, _o: unknown, fn: (c: unknown) => unknown) =>
          fn(sshClient),
      ),
    },
    services: { get: vi.fn(() => service) },
    audit: { exportBatches: vi.fn(() => batches()) },
    log: {
      info: (m: string) => logs.push(`info ${m}`),
      error: (m: string) => logs.push(`error ${m}`),
    },
    fetch: vi.fn(async () => new Response("pong", { status: 201 })),
    process: {
      run: vi.fn(async () => ({
        pid: 42,
        onStdout: vi.fn(),
        onStderr: vi.fn(),
        kill: vi.fn(),
        exited: Promise.resolve({ code: 0, signal: null }),
      })),
    },
    auth: {
      registerSshAuthProvider: vi.fn(),
      registerLoginMethod: vi.fn(),
      registerKeyboardInteractiveHandler: vi.fn(),
      completeRedirectLogin: vi.fn(
        async (_id: string, _req: unknown, res: { redirect: AnyFn }) =>
          res.redirect("/done"),
      ),
    },
  };
  const bridge = new PluginBridge(transport, {
    manifest: { id: pluginId, capabilities: [], sandbox: {} } as never,
    ctx: ctx as never,
    tokens,
    dialect: "sqlite",
  });
  let id = 0;
  const send = async (
    m: string,
    a: unknown[] = [],
    k?: string,
    kind: "call" | "fn" = "call",
  ) => {
    const message = (
      kind === "fn"
        ? { t: "fn", id: ++id, f: m, a, k }
        : { t: "call", id: ++id, m, a, k }
    ) as Wire;
    toHost.forEach((h) => h(message));
    for (let i = 0; i < 20; i++) {
      const reply = replies.find(
        (r) =>
          (r.t === "ok" || r.t === "err") &&
          r.id === (message as { id: number }).id,
      );
      if (reply) return reply as Reply;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no reply to ${m}`);
  };
  const token = (userId = "alice") =>
    tokens.mint({ pluginId, userId, kind: "request" });
  return { bridge, send, token, ctx, routes, sshClient, service, logs };
}

beforeEach(() => {
  granted.credentials = false;
  sql.run.mockClear();
  sql.batch.mockClear();
});

describe("http routes", () => {
  it("builds the router once and mirrors routes onto it", async () => {
    const h = harness();
    expect(await h.send("http.route", ["get", "/x"])).toMatchObject({
      t: "err",
      e: { message: "ctx.http.router() was not called" },
    });
    expect(await h.send("http.router", [{ rawBody: true }])).toMatchObject({
      t: "ok",
      v: true,
    });
    expect(await h.send("http.router", [{}])).toMatchObject({ t: "err" });
    expect(await h.send("http.route", ["get", "/items"])).toMatchObject({
      t: "ok",
    });
    expect(await h.send("http.route", ["use"])).toMatchObject({ t: "ok" });
    expect(h.routes).toEqual([
      ["get", "/items"],
      ["use", expect.any(Function)],
    ]);
  });

  it("refuses unknown methods and odd paths", async () => {
    const h = harness();
    await h.send("http.router", [{}]);
    expect(await h.send("http.route", ["constructor", "/x"])).toMatchObject({
      t: "err",
      e: { message: "Unsupported route method constructor" },
    });
    expect(await h.send("http.route", ["get", { bad: 1 }])).toMatchObject({
      t: "err",
      e: { message: "Route paths must be strings" },
    });
  });
});

describe("rbac checks", () => {
  it("runs core's real middleware as the token's user", async () => {
    const h = harness();
    expect(
      await h.send("rbac.check", ["view"], h.token("alice")),
    ).toMatchObject({ t: "ok", v: { next: true } });
    expect(await h.send("rbac.check", ["view"], h.token("bob"))).toMatchObject({
      t: "ok",
      v: { status: 403, body: { error: "no" } },
    });
    expect(await h.send("rbac.check", ["undeclared"], h.token())).toMatchObject(
      { t: "err" },
    );
  });
});

describe("sockets", () => {
  it("registers socket and upgrade routes with core", async () => {
    const h = harness();
    await h.send("ws.route", ["/live", { auth: true }]);
    await h.send("ws.upgrade", ["/raw", {}]);
    expect(h.ctx.ws.route).toHaveBeenCalledWith("/live", expect.any(Function), {
      auth: true,
    });
    expect(h.ctx.ws.upgrade).toHaveBeenCalledWith(
      "/raw",
      expect.any(Function),
      {},
    );
  });
});

describe("database", () => {
  it("only lets queries touch the plugin's own tables", async () => {
    const h = harness();
    await h.send("db.define", [{ name: "items" }]);
    expect(
      await h.send("db.query", ["select * from p_docker_items", [1], "all"]),
    ).toMatchObject({ t: "ok", v: [{ ok: 1 }] });
    expect(sql.run).toHaveBeenCalledWith(
      "sqlite",
      "select * from p_docker_items",
      [1],
      "all",
    );
    const refused = await h.send("db.query", [
      "select * from users",
      [],
      "all",
    ]);
    expect(refused).toMatchObject({ t: "err", e: { code: "SANDBOX_SQL" } });
    expect(sql.run).toHaveBeenCalledTimes(1);
  });

  it("checks every statement in a batch and caps its size", async () => {
    const h = harness();
    await h.send("db.define", [{ name: "items" }]);
    expect(
      await h.send("db.batch", [
        [{ sql: "delete from p_docker_items", params: [] }],
      ]),
    ).toMatchObject({ t: "ok" });
    expect(
      await h.send("db.batch", [
        [
          { sql: "delete from p_docker_items" },
          { sql: "delete from sessions" },
        ],
      ]),
    ).toMatchObject({ t: "err", e: { code: "SANDBOX_SQL" } });
    expect(sql.batch).toHaveBeenCalledTimes(1);
    expect(await h.send("db.batch", ["nope"])).toMatchObject({
      t: "err",
      e: { code: "SANDBOX_SQL" },
    });
    const many = Array.from({ length: 501 }, () => ({
      sql: "delete from p_docker_items",
    }));
    expect(await h.send("db.batch", [many])).toMatchObject({ t: "err" });
  });

  it("runs the client check without handing the client out", async () => {
    const h = harness();
    expect(await h.send("db.client")).toMatchObject({ t: "ok", v: true });
    expect(await h.send("db.refs")).toMatchObject({ t: "ok", v: [] });
  });
});

describe("ssh handles", () => {
  it("hands out a handle and strips secrets without credentials:read", async () => {
    const h = harness();
    const reply = await h.send("ssh.connect", [1, {}]);
    expect(reply).toMatchObject({ t: "ok" });
    const value = (reply as { v: { client: { $ssh: string }; host: object } })
      .v;
    expect(value.client.$ssh).toMatch(/^client/);
    expect(JSON.stringify(value.host)).not.toContain("hunter2");
  });

  it("keeps the host as is with credentials:read", async () => {
    granted.credentials = true;
    const h = harness();
    const reply = (await h.send("ssh.connect", [1, {}])) as {
      v: { host: object };
    };
    expect(JSON.stringify(reply.v.host)).toContain("hunter2");
  });

  it("refuses channel methods outside the list and dead handles", async () => {
    const h = harness();
    const reply = (await h.send("ssh.connect", [1, {}])) as {
      v: { client: { $ssh: string } };
    };
    const id = reply.v.client.$ssh;
    expect(await h.send("ssh.channel", [id, "write", []])).toMatchObject({
      t: "err",
      e: { code: "SANDBOX_HANDLE" },
    });
    expect(await h.send("ssh.end", [id])).toMatchObject({ t: "ok" });
    expect(h.sshClient.end).toHaveBeenCalled();
    expect(await h.send("ssh.end", [id])).toMatchObject({
      t: "err",
      e: { code: "SANDBOX_HANDLE" },
    });
    expect(await h.send("ssh.exec", ["client999", "ls"])).toMatchObject({
      t: "err",
      e: { code: "SANDBOX_HANDLE" },
    });
  });

  it("drops the handle when the connection closes", async () => {
    const h = harness();
    const reply = (await h.send("ssh.connect", [1, {}])) as {
      v: { client: { $ssh: string } };
    };
    h.sshClient.emit("close");
    expect(await h.send("ssh.end", [reply.v.client.$ssh])).toMatchObject({
      t: "err",
      e: { code: "SANDBOX_HANDLE" },
    });
  });

  it("needs a callback for withConnection", async () => {
    const h = harness();
    expect(await h.send("ssh.withConnection", [1, {}, "x"])).toMatchObject({
      t: "err",
      e: { message: "A callback is needed" },
    });
  });

  it("only allows listed sftp methods and returns plain stats", async () => {
    const h = harness();
    const conn = (await h.send("ssh.connect", [1, {}])) as {
      v: { client: { $ssh: string } };
    };
    const opened = (await h.send("ssh.sftp", [conn.v.client.$ssh])) as {
      v: { $sftp: string };
    };
    const id = opened.v.$sftp;
    expect(await h.send("sftp.call", [id, "constructor", []])).toMatchObject({
      t: "err",
      e: { message: "SFTP method constructor is not available" },
    });
    const stat = (await h.send("sftp.call", [id, "stat", ["/etc/hosts"]])) as {
      t: string;
      v: Record<string, unknown>;
    };
    expect(stat.t).toBe("ok");
    expect(stat.v).toMatchObject({
      size: 5,
      $stats: { dir: false, file: true, link: false },
    });
    expect(await h.send("sftp.end", [id])).toMatchObject({ t: "ok" });
    expect(await h.send("sftp.end", [id])).toMatchObject({ t: "err" });
  });
});

describe("services", () => {
  it("reuses one handle per service and options and calls methods by name", async () => {
    const h = harness();
    const a = (await h.send("services.get", ["svc", { x: 1 }])) as {
      v: { $svc: string };
    };
    const b = (await h.send("services.get", ["svc", { x: 1 }])) as {
      v: { $svc: string };
    };
    expect(a.v.$svc).toBe(b.v.$svc);
    expect(h.ctx.services.get).toHaveBeenCalledTimes(1);
    expect(
      await h.send("services.call", [a.v.$svc, "list", [1, 2]]),
    ).toMatchObject({ t: "ok", v: ["listed", 1, 2] });
  });

  it("refuses odd names, asUser by call and missing methods", async () => {
    const h = harness();
    const a = (await h.send("services.get", ["svc"])) as {
      v: { $svc: string };
    };
    for (const name of ["asUser", "a.b", "__proto__x;"]) {
      expect(await h.send("services.call", [a.v.$svc, name, []])).toMatchObject(
        { t: "err" },
      );
    }
    expect(await h.send("services.call", [a.v.$svc, "nope", []])).toMatchObject(
      { t: "err", e: { code: "SERVICE_METHOD_MISSING" } },
    );
  });

  it("makes a separate handle for asUser and reuses it", async () => {
    const h = harness();
    const a = (await h.send("services.get", ["svc"])) as {
      v: { $svc: string };
    };
    const one = (await h.send("services.asUser", [a.v.$svc, "bob"])) as {
      v: { $svc: string };
    };
    const two = (await h.send("services.asUser", [a.v.$svc, "bob"])) as {
      v: { $svc: string };
    };
    expect(one.v.$svc).toBe(two.v.$svc);
    expect(one.v.$svc).not.toBe(a.v.$svc);
    expect(
      await h.send("services.call", [one.v.$svc, "who", []]),
    ).toMatchObject({ t: "ok", v: "bob" });
  });
});

describe("audit export", () => {
  it("walks the batches and drops the handle when done", async () => {
    const h = harness();
    const opened = (await h.send("audit.exportBatches.open", [{}])) as {
      v: string;
    };
    expect(await h.send("audit.exportBatches.next", [opened.v])).toMatchObject({
      v: { done: false, value: [{ id: 1 }] },
    });
    expect(await h.send("audit.exportBatches.next", [opened.v])).toMatchObject({
      v: { done: false, value: [{ id: 2 }] },
    });
    expect(await h.send("audit.exportBatches.next", [opened.v])).toMatchObject({
      v: { done: true },
    });
    expect(await h.send("audit.exportBatches.next", [opened.v])).toMatchObject({
      t: "err",
      e: { code: "SANDBOX_HANDLE" },
    });
    expect(await h.send("audit.exportBatches.close", [opened.v])).toMatchObject(
      { t: "ok" },
    );
  });
});

describe("log and fetch", () => {
  it("writes logs at a known level, cut to 4000 characters", async () => {
    const h = harness();
    await h.send("log", ["info", "hello"]);
    await h.send("log", ["shout", "x".repeat(5000)]);
    expect(h.logs[0]).toBe("info hello");
    expect(h.logs[1]).toBe(`error ${"x".repeat(4000)}`);
  });

  it("returns fetch results as plain data", async () => {
    const h = harness();
    const reply = (await h.send("ctx.fetch", ["https://example.test", {}])) as {
      v: { status: number; body: Uint8Array };
    };
    expect(reply.v.status).toBe(201);
    expect(Buffer.from(reply.v.body).toString()).toBe("pong");
  });

  it("logs a plugin line with its id", () => {
    const write = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    sandboxLog("docker", "started");
    write.mockRestore();
    info.mockRestore();
  });
});

describe("child processes", () => {
  it("runs in core with plain options and hands back a way to wait", async () => {
    const h = harness();
    const reply = (await h.send(
      "ctx.process.run",
      [
        "/usr/bin/opkssh",
        ["login", 5],
        { cwd: "/tmp", shell: true, env: { A: "1" } },
      ],
      h.token(),
    )) as { t: string; v: Record<string, { $f?: string }> & { pid: number } };
    expect(reply.t).toBe("ok");
    expect(h.ctx.process.run).toHaveBeenCalledWith(
      "/usr/bin/opkssh",
      ["login", "5"],
      { cwd: "/tmp", env: { A: "1" } },
    );
    expect(reply.v.pid).toBe(42);
    expect(Object.keys(reply.v).sort()).toEqual([
      "kill",
      "onStderr",
      "onStdout",
      "pid",
      "waitExit",
    ]);
    const waited = await h.send(
      String(reply.v.waitExit.$f),
      [],
      h.token(),
      "fn",
    );
    expect(waited).toMatchObject({ t: "ok", v: { code: 0, signal: null } });
  });
});

describe("ssh auth providers", () => {
  it("takes the banner hook as an async call", async () => {
    const h = harness();
    expect(
      await h.send("ctx.auth.registerSshAuthProvider", [
        { type: "x", prepare: { $f: "cf1" }, onBanner: { $f: "cf2" } },
      ]),
    ).toMatchObject({ t: "ok", v: true });
    const provider = h.ctx.auth.registerSshAuthProvider.mock.calls[0][0] as {
      remote: boolean;
      onBanner: unknown;
    };
    expect(provider.remote).toBe(true);
    expect(typeof provider.onBanner).toBe("function");
  });

  it("registers a wrapped provider with core", async () => {
    const h = harness();
    expect(
      await h.send("ctx.auth.registerSshAuthProvider", [
        { type: "vault", labelKey: "k", prepare: { $f: "cf1" } },
      ]),
    ).toMatchObject({ t: "ok", v: true });
    const provider = h.ctx.auth.registerSshAuthProvider.mock.calls[0][0] as {
      type: string;
      prepare: unknown;
    };
    expect(provider.type).toBe("vault");
    expect(typeof provider.prepare).toBe("function");
  });
});

describe("closing", () => {
  it("answers 503 for routes after the process is gone", async () => {
    const h = harness();
    await h.send("http.router", [{}]);
    h.bridge.close("stopped");
    const res = {
      code: 0,
      body: undefined as unknown,
      status(c: number) {
        this.code = c;
        return this;
      },
      json(b: unknown) {
        this.body = b;
      },
    };
    await (
      h.bridge as unknown as {
        dispatchHttp: (a: unknown, b: unknown, c: unknown) => Promise<void>;
      }
    ).dispatchHttp({}, res, () => {});
    expect(res.code).toBe(503);
  });

  it("mints a callback token for the current actor", () => {
    const h = harness();
    const t = runAsActor("carol", "request", () =>
      h.bridge.mintForCurrentActor(),
    );
    expect(t).toBeTruthy();
  });
});

describe("login methods", () => {
  it("registers a wrapped method and refuses a bad one", async () => {
    const h = harness();
    expect(
      await h.send("ctx.auth.registerLoginMethod", [
        { id: "m", labelKey: "k", kind: "form", verify: { $f: "cf1" } },
      ]),
    ).toMatchObject({ t: "ok", v: true });
    const method = h.ctx.auth.registerLoginMethod.mock.calls[0][0] as {
      id: string;
      verify: unknown;
    };
    expect(method.id).toBe("m");
    expect(typeof method.verify).toBe("function");
    expect(
      await h.send("ctx.auth.registerLoginMethod", [
        { id: "m", labelKey: "k", kind: "magic" },
      ]),
    ).toMatchObject({ t: "err", e: { code: "SANDBOX_VALUE" } });
  });

  it("registers a keyboard-interactive handler marked remote", async () => {
    const h = harness();
    expect(
      await h.send("ctx.auth.registerKeyboardInteractiveHandler", [
        { id: "k", label: "K", detect: { $f: "cf1" } },
      ]),
    ).toMatchObject({ t: "ok", v: true });
    const handler = h.ctx.auth.registerKeyboardInteractiveHandler.mock
      .calls[0][0] as { remote: boolean };
    expect(handler.remote).toBe(true);
  });

  it("finishes a redirect login only inside a live request of the plugin", async () => {
    const h = harness();
    expect(
      await h.send("ctx.auth.completeRedirectLogin", ["m"], h.token()),
    ).toMatchObject({ t: "err", e: { code: "SANDBOX_UNSUPPORTED" } });
    expect(h.ctx.auth.completeRedirectLogin).not.toHaveBeenCalled();

    const token = h.token();
    const res = { headersSent: false, redirect: vi.fn() };
    const live = { req: { url: "/callback" }, res, handedOff: false };
    (
      h.bridge as unknown as { liveRequests: Map<string, unknown> }
    ).liveRequests.set(token, live);
    expect(
      await h.send("ctx.auth.completeRedirectLogin", ["m"], token),
    ).toMatchObject({ t: "ok", v: true });
    expect(h.ctx.auth.completeRedirectLogin).toHaveBeenCalledWith(
      "m",
      live.req,
      res,
    );
    expect(res.redirect).toHaveBeenCalledWith("/done");
    expect(live.handedOff).toBe(true);
  });
});
