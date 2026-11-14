/**
 * Real plugin processes: the child runtime is built with esbuild, then each
 * case starts a small plugin under the supervisor and checks what it can and
 * can't do, and what the supervisor does when it misbehaves.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../../../plugins/permissions.js", () => ({
  hasCapability: async (_id: string, capability: string, declared: string[]) =>
    declared.includes(capability),
}));

const logged = vi.hoisted(() => [] as { text: string; meta: unknown }[]);
vi.mock("../../../utils/logger.js", () => {
  const record = (text: string, a?: unknown, b?: unknown) =>
    logged.push({ text, meta: b ?? a });
  return {
    pluginLogger: {
      info: record,
      warn: record,
      error: record,
      debug: record,
      success: record,
    },
  };
});

import {
  SandboxSupervisor,
  type SandboxConfig,
} from "../../../plugins/sandbox/supervisor.js";
import {
  createPluginHandle,
  disposePluginHandle,
} from "../../../plugins/ctx.js";

const repo = path.resolve(__dirname, "../../../../..");
const buildDir = path.join(
  repo,
  "node_modules",
  ".cache",
  "termix-sandbox-test",
);
const runtime = path.join(buildDir, "child", "runtime.mjs");
const harden = path.join(buildDir, "child", "harden.mjs");
let work: string;
let secretFile: string;

beforeAll(async () => {
  const esbuild = await import("esbuild");
  const src = path.join(repo, "src", "backend", "plugins", "sandbox", "child");
  await esbuild.build({
    entryPoints: {
      runtime: path.join(src, "runtime.ts"),
      harden: path.join(src, "harden.ts"),
    },
    outdir: path.join(buildDir, "child"),
    outExtension: { ".js": ".mjs" },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent",
  });
  work = fs.mkdtempSync(path.join(os.tmpdir(), "tmx-sandbox-"));
  process.env.DATA_DIR = path.join(work, "data");
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  secretFile = path.join(process.env.DATA_DIR, "db.sqlite.encrypted");
  fs.writeFileSync(secretFile, "not for plugins");
  process.env.TERMIX_TEST_SECRET = "never-in-a-plugin";
}, 60_000);

afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
  delete process.env.TERMIX_TEST_SECRET;
});

beforeEach(() => {
  logged.length = 0;
});

function config(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
  return {
    idleMs: 60_000,
    cpuPercent: 80,
    memoryMb: 128,
    alwaysOn: new Set(),
    healthIntervalMs: 100,
    healthTimeoutMs: 1500,
    cpuWindowMs: 600,
    backoffStartMs: 50,
    paths: {
      runtime,
      harden,
      reads: [
        path.join(repo, "node_modules"),
        path.join(repo, "packages", "plugin-sdk"),
        path.join(repo, "package.json"),
      ],
    },
    ...overrides,
  };
}

/** A plugin folder with an ESM backend built from `body`. */
function plugin(id: string, body: string): { dir: string; entry: string } {
  const dir = path.join(work, "plugins", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  const entry = path.join(dir, "backend.js");
  fs.writeFileSync(entry, body);
  return { dir, entry };
}

function spec(
  id: string,
  entry: { dir: string; entry: string },
  extra: {
    capabilities?: string[];
    sandbox?: Record<string, unknown>;
    report?: (value: unknown) => void;
    onFailed?: (message: string) => void;
    ctx?: Record<string, unknown>;
  } = {},
) {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      capabilities: extra.capabilities ?? [],
      engine: { api: "^2.0.0", termix: "*" },
      sandbox: extra.sandbox,
    } as never,
    dir: entry.dir,
    entryPath: entry.entry,
    makeContext: () => {
      const handle = createPluginHandle(id, { activate: () => undefined });
      const ctx = {
        pluginId: id,
        report: async (value: unknown) => extra.report?.(value),
        log: {
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {},
        },
        ...extra.ctx,
      };
      return { ctx, handle };
    },
    disposeHandle: (handle: ReturnType<typeof createPluginHandle>) =>
      disposePluginHandle(handle, id, { runDeactivate: false }),
    onFailed: extra.onFailed ?? (() => {}),
  };
}

const until = async (check: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

const PROBES = `
import fs from "node:fs";
import path from "node:path";
const tryIt = async (fn) => {
  try { await fn(); return "open"; }
  catch (error) { return error.code ?? error.message; }
};
export async function activate(ctx) {
  const out = {};
  out.readSecret = await tryIt(() => fs.readFileSync(process.env.PROBE_FILE ?? ${JSON.stringify("SECRET")}));
  out.writeOutside = await tryIt(() => fs.writeFileSync(path.join(${JSON.stringify("WORK")}, "escape.txt"), "x"));
  out.childProcess = await tryIt(async () => (await import("node:child_process")).spawnSync(process.execPath, ["-v"]));
  out.worker = await tryIt(async () => new (await import("node:worker_threads")).Worker("1", { eval: true }));
  out.sqlite = await tryIt(() => import("node:sqlite"));
  out.sqliteBuiltin = await tryIt(() => process.getBuiltinModule("node:sqlite"));
  out.debugProcess = await tryIt(() => process._debugProcess(process.ppid));
  out.binding = await tryIt(() => process.binding("fs"));
  out.inspector = await tryIt(() => import("node:inspector"));
  out.net = await tryIt(() => new Promise((resolve, reject) => {
    import("node:net").then((net) => {
      const server = net.createServer();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => server.close(resolve));
    }, reject);
  }));
  out.secretEnv = process.env.TERMIX_TEST_SECRET ?? null;
  out.dataDir = process.env.DATA_DIR ?? null;
  await ctx.report(out);
}
`;

describe("plugin process fence", () => {
  it("can't read or write outside its grants, start processes or reach core", async () => {
    let probes: Record<string, unknown> | null = null;
    const body = PROBES.replace(
      JSON.stringify("SECRET"),
      JSON.stringify(secretFile),
    ).replace(JSON.stringify("WORK"), JSON.stringify(work));
    const supervisor = new SandboxSupervisor(config());
    await supervisor.register(
      spec("probe", plugin("probe", body), {
        sandbox: { alwaysOn: true },
        report: (value) => {
          probes = value as Record<string, unknown>;
        },
      }),
    );
    await until(() => probes !== null);
    await supervisor.shutdown();

    expect(probes).toMatchObject({
      readSecret: "ERR_ACCESS_DENIED",
      writeOutside: "ERR_ACCESS_DENIED",
      childProcess: "ERR_ACCESS_DENIED",
      worker: "ERR_ACCESS_DENIED",
      sqlite: "ERR_ACCESS_DENIED",
      sqliteBuiltin: "ERR_ACCESS_DENIED",
      debugProcess: "ERR_ACCESS_DENIED",
      binding: "ERR_ACCESS_DENIED",
      inspector: "ERR_ACCESS_DENIED",
      secretEnv: null,
      dataDir: null,
    });
    expect(fs.existsSync(path.join(work, "escape.txt"))).toBe(false);
    // Node 25 and later fence sockets; 24 has no network scope at all.
    const major = Number(process.versions.node.split(".")[0]);
    expect(probes!.net).toBe(major >= 25 ? "ERR_ACCESS_DENIED" : "open");
  }, 30_000);

  it("gets sockets only with network:sockets on a Node that can fence them", async () => {
    const major = Number(process.versions.node.split(".")[0]);
    let net: unknown = null;
    const body = `
      export async function activate(ctx) {
        const result = await new Promise((resolve) => {
          import("node:net").then((m) => {
            const s = m.createServer();
            s.on("error", (e) => resolve(e.code));
            s.listen(0, "127.0.0.1", () => s.close(() => resolve("open")));
          });
        });
        await ctx.report(result);
      }`;
    const supervisor = new SandboxSupervisor(config());
    await supervisor.register(
      spec("sockets", plugin("sockets", body), {
        capabilities: ["network:sockets"],
        sandbox: { alwaysOn: true },
        report: (value) => {
          net = value;
        },
      }),
    );
    await until(() => net !== null);
    await supervisor.shutdown();
    expect(net).toBe("open");
    expect(major).toBeGreaterThan(0);
  }, 30_000);
});

describe("supervisor", () => {
  it("starts a routes only plugin on first use and stops it when idle", async () => {
    const supervisor = new SandboxSupervisor(config({ idleMs: 300 }));
    await supervisor.register(
      spec("lazy", plugin("lazy", "export function activate() {}")),
    );
    expect(supervisor.status()[0]).toMatchObject({
      state: "stopped",
      alwaysOn: false,
    });
    expect(await supervisor.wake("lazy")).toBe(true);
    expect(supervisor.status()[0].state).toBe("ready");
    await until(() => supervisor.status()[0].state === "stopped", 5000);
    await supervisor.shutdown();
  }, 30_000);

  it("keeps a plugin with schedules or listeners on", async () => {
    const supervisor = new SandboxSupervisor(config({ idleMs: 200 }));
    await supervisor.register(
      spec("busy", plugin("busy", "export function activate() {}"), {
        sandbox: { events: ["host.deleted"] },
      }),
    );
    expect(supervisor.status()[0]).toMatchObject({
      state: "ready",
      alwaysOn: true,
    });
    await new Promise((r) => setTimeout(r, 600));
    expect(supervisor.status()[0].state).toBe("ready");
    await supervisor.shutdown();
  }, 30_000);

  it("restarts a crashed plugin with backoff, then marks it failed", async () => {
    let starts = 0;
    let failed: string | null = null;
    const supervisor = new SandboxSupervisor(config());
    await supervisor.register(
      spec(
        "crashy",
        plugin(
          "crashy",
          `export async function activate(ctx) {
            await ctx.report(1);
            setTimeout(() => process.exit(3), 30);
          }`,
        ),
        {
          sandbox: { alwaysOn: true },
          report: () => {
            starts++;
          },
          onFailed: (message) => {
            failed = message;
          },
        },
      ),
    );
    await until(() => failed !== null, 20_000);
    expect(starts).toBe(5);
    expect(failed).toMatch(/5 times/);
    expect(supervisor.status()[0].state).toBe("failed");
    await supervisor.shutdown();
  }, 30_000);

  it("kills a plugin that stops answering and starts it again", async () => {
    let starts = 0;
    const supervisor = new SandboxSupervisor(config({ healthTimeoutMs: 400 }));
    await supervisor.register(
      spec(
        "hung",
        plugin(
          "hung",
          `let first = true;
          export async function activate(ctx) {
            await ctx.report(1);
            if (process.env.HUNG_ONCE !== "no") setTimeout(() => { for (;;) {} }, 50);
          }`,
        ),
        { sandbox: { alwaysOn: true }, report: () => starts++ },
      ),
    );
    await until(() => starts >= 2, 15_000);
    expect(logged.some((l) => /stopped answering/.test(l.text))).toBe(true);
    await supervisor.shutdown();
  }, 30_000);

  it("restarts a plugin that keeps burning CPU past its cap", async () => {
    let starts = 0;
    // Low cap: under a busy full test run the spinner gets far less than a
    // core, and must still go over it.
    const supervisor = new SandboxSupervisor(config({ cpuPercent: 10 }));
    await supervisor.register(
      spec(
        "spin",
        plugin(
          "spin",
          `export async function activate(ctx) {
            await ctx.report(1);
            setInterval(() => { const end = Date.now() + 95; while (Date.now() < end) {} }, 100);
          }`,
        ),
        { sandbox: { alwaysOn: true }, report: () => starts++ },
      ),
    );
    await until(() => starts >= 2, 25_000);
    expect(logged.some((l) => /CPU/.test(l.text))).toBe(true);
    await supervisor.shutdown();
  }, 30_000);

  it("restarts a plugin that runs past its memory cap", async () => {
    let starts = 0;
    const supervisor = new SandboxSupervisor(config({ memoryMb: 64 }));
    await supervisor.register(
      spec(
        "hungry",
        plugin(
          "hungry",
          `const keep = [];
          export async function activate(ctx) {
            await ctx.report(1);
            setTimeout(() => { for (;;) keep.push(new Array(1e5).fill("x".repeat(10))); }, 30);
          }`,
        ),
        { sandbox: { alwaysOn: true }, report: () => starts++ },
      ),
    );
    await until(() => starts >= 2, 20_000);
    await supervisor.shutdown();
  }, 30_000);

  it("tags the plugin's own output with its id", async () => {
    const supervisor = new SandboxSupervisor(config());
    await supervisor.register(
      spec(
        "chatty",
        plugin(
          "chatty",
          `export function activate() { console.log("hello from chatty"); }`,
        ),
        { sandbox: { alwaysOn: true } },
      ),
    );
    await until(() => logged.some((l) => l.text.includes("hello from chatty")));
    const line = logged.find((l) => l.text.includes("hello from chatty"))!;
    expect(line.text).toMatch(/^Plugin chatty:/);
    expect(line.meta).toMatchObject({ pluginId: "chatty" });
    await supervisor.shutdown();
  }, 30_000);
});

describe("plugin process env", () => {
  it("passes only the variables the manifest lists, never core's", async () => {
    const { pluginEnv } =
      await import("../../../plugins/sandbox/supervisor.js");
    const env = pluginEnv(
      {
        id: "snippets",
        env: [
          { name: "SNIPPET_EXECUTION_TIMEOUT_SECONDS" },
          { name: "JWT_SECRET" },
          { name: "NODE_OPTIONS" },
          { name: "MISSING_ONE" },
        ],
      } as never,
      {
        NODE_ENV: "production",
        SNIPPET_EXECUTION_TIMEOUT_SECONDS: "60",
        JWT_SECRET: "core only",
        NODE_OPTIONS: "--inspect",
        DATABASE_KEY: "core only",
      },
      () => false,
    );
    expect(env).toEqual({
      NODE_ENV: "production",
      TERMIX_SANDBOX_PLUGIN: "snippets",
      TERMIX_DEPLOYMENT: "server",
      SNIPPET_EXECUTION_TIMEOUT_SECONDS: "60",
    });
  });

  it("passes core's version and where it runs", async () => {
    const { pluginEnv } =
      await import("../../../plugins/sandbox/supervisor.js");
    const manifest = { id: "telemetry" } as never;
    expect(
      pluginEnv(manifest, { VERSION: "26.11.2" }, (f) => f === "/.dockerenv"),
    ).toMatchObject({ VERSION: "26.11.2", TERMIX_DEPLOYMENT: "docker" });
    expect(
      pluginEnv(manifest, { ELECTRON_EMBEDDED: "true" }, () => true),
    ).toMatchObject({ TERMIX_DEPLOYMENT: "desktop" });
  });
});

describe("auth hooks in a plugin process", () => {
  it("runs a login method and a keyboard handler across the process", async () => {
    const methods: Array<
      Record<string, (...a: unknown[]) => Promise<unknown>>
    > = [];
    const handlers: Array<
      Record<string, (...a: unknown[]) => Promise<unknown>>
    > = [];
    const fetched: unknown[] = [];
    const supervisor = new SandboxSupervisor(config());
    await supervisor.register(
      spec(
        "loginp",
        plugin(
          "loginp",
          `
export function activate(ctx) {
  ctx.auth.registerLoginMethod({
    id: "m", labelKey: "k", kind: "redirect",
    start: async (request) => {
      const token = await ctx.fetch("https://idp/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=authorization_code&code=c",
        tls: { ca: "PEM" },
        allowPrivateHosts: ["idp"],
        signal: AbortSignal.timeout(60000),
      });
      if ((await token.text()) !== "ok") throw new Error("fetch body lost");
      request.res.cookie("tmxp_loginp_state", "s1", { httpOnly: true, domain: "evil.example" });
      request.res.cookie("jwt", "forged", {});
      return { redirectUrl: "https://idp/auth?b=" + ctx.http.baseUrl(request) + "&c=" + (request.headers.cookie ?? "") };
    },
    callback: async (request) => {
      request.res.clearCookie("tmxp_loginp_state", {});
      throw Object.assign(new Error("other browser"), { status: 400, returnTo: "https://t/" });
    },
  });
  ctx.auth.registerKeyboardInteractiveHandler({
    id: "k", label: "K",
    detect: (round, host) => ({ kind: "browser", url: "https://k/" + (host.password ?? "none"), code: "1234", instructions: round.name }),
  });
}
`,
        ),
        {
          capabilities: ["auth:provide", "network:outbound"],
          ctx: {
            auth: {
              registerLoginMethod: (m: never) => methods.push(m),
              registerKeyboardInteractiveHandler: (h: never) =>
                handlers.push(h),
            },
            http: { baseUrl: () => "https://termix.example" },
            fetch: async (url: string, init: unknown) => {
              fetched.push([url, init]);
              return new Response("ok");
            },
          },
        },
      ),
    );
    await until(() => methods.length === 1 && handlers.length === 1);

    const res = { cookie: vi.fn(), clearCookie: vi.fn(), headersSent: false };
    const req = {
      body: {},
      query: {},
      headers: { cookie: "jwt=secret; tmxp_loginp_state=old" },
      ip: "10.0.0.9",
      res,
    };
    const started = (await methods[0].start(req, null)) as {
      redirectUrl: string;
    };
    expect(started.redirectUrl).toBe(
      "https://idp/auth?b=https://termix.example&c=tmxp_loginp_state=old",
    );
    expect(fetched).toEqual([
      [
        "https://idp/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=authorization_code&code=c",
          tls: { ca: "PEM" },
          allowPrivateHosts: ["idp"],
        },
      ],
    ]);
    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith("tmxp_loginp_state", "s1", {
      httpOnly: true,
    });

    await expect(methods[0].callback(req)).rejects.toMatchObject({
      message: "other browser",
      status: 400,
      returnTo: "https://t/",
    });
    expect(res.clearCookie).toHaveBeenCalledWith("tmxp_loginp_state", {});

    expect(
      await handlers[0].detect(
        { name: "Bastion", instructions: "", prompts: [] },
        { id: 1, password: "hunter2" },
        {},
      ),
    ).toEqual({
      kind: "browser",
      url: "https://k/none",
      code: "1234",
      instructions: "Bastion",
    });
    await supervisor.shutdown();
  }, 30_000);
});

const WORKER_PROBES = `
import fs from "node:fs";
import { Worker, parentPort, workerData } from "node:worker_threads";
const tryIt = async (fn) => {
  try { await fn(); return "open"; }
  catch (error) { return error.code ?? error.message; }
};
const out = { data: workerData, argv: process.argv.slice(1) };
out.readSecret = await tryIt(() => fs.readFileSync(workerData.secret));
out.childProcess = await tryIt(async () => (await import("node:child_process")).spawnSync(process.execPath, ["-v"]));
out.sqlite = await tryIt(() => import("node:sqlite"));
out.nestedEval = await tryIt(() => new Worker("1", { eval: true, execArgv: [] }));
parentPort.postMessage(out);
`;

const WORKER_MAIN = `
import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const tryIt = async (fn) => {
  try { await fn(); return "open"; }
  catch (error) { return error.code ?? error.message; }
};
const run = (make) => new Promise((resolve) => {
  let worker;
  try { worker = make(); } catch (error) { resolve(error.code ?? error.message); return; }
  worker.once("message", (m) => { resolve(m); void worker.terminate(); });
  worker.once("error", (e) => resolve("error: " + e.message));
});
export async function activate(ctx) {
  const file = path.join(here, "probe-worker.mjs");
  const out = {};
  out.plain = await run(() => new Worker(file, { argv: ["--json"], workerData: { secret: SECRET } }));
  out.emptyArgv = await run(() => new Worker(file, { execArgv: [], workerData: { secret: SECRET } }));
  out.viaPrototype = await run(() => new Worker.prototype.constructor(file, { execArgv: [], workerData: { secret: SECRET } }));
  out.eval = await tryIt(() => new Worker("1", { eval: true }));
  out.dataUrl = await tryIt(() => new Worker(new URL("data:text/javascript,1")));
  await ctx.report(out);
}
`;

describe("worker threads", () => {
  it("keep the process's fence and load harden first", async () => {
    let probes: Record<string, unknown> | null = null;
    const files = plugin(
      "workers",
      WORKER_MAIN.replaceAll("SECRET", JSON.stringify(secretFile)),
    );
    fs.writeFileSync(path.join(files.dir, "probe-worker.mjs"), WORKER_PROBES);
    const supervisor = new SandboxSupervisor(config());
    await supervisor.register(
      spec("workers", files, {
        sandbox: { alwaysOn: true, workers: true },
        report: (value) => {
          probes = value as Record<string, unknown>;
        },
      }),
    );
    await until(() => probes !== null, 20_000);
    await supervisor.shutdown();

    const fenced = {
      readSecret: "ERR_ACCESS_DENIED",
      childProcess: "ERR_ACCESS_DENIED",
      sqlite: "ERR_ACCESS_DENIED",
      nestedEval: "ERR_ACCESS_DENIED",
    };
    expect(probes).toMatchObject({
      plain: fenced,
      emptyArgv: fenced,
      viaPrototype: fenced,
      eval: "ERR_ACCESS_DENIED",
      dataUrl: "ERR_ACCESS_DENIED",
    });
    // A plain worker sees its own file at process.argv[1].
    expect((probes!.plain as { argv: string[] }).argv).toEqual([
      expect.stringMatching(/probe-worker.mjs$/),
      "--json",
    ]);
    expect((probes!.plain as { data: unknown }).data).toEqual({
      secret: secretFile,
    });
  }, 40_000);

  it("can't start without sandbox.workers", async () => {
    let probes: Record<string, unknown> | null = null;
    const files = plugin(
      "noworkers",
      WORKER_MAIN.replaceAll("SECRET", JSON.stringify(secretFile)),
    );
    fs.writeFileSync(path.join(files.dir, "probe-worker.mjs"), WORKER_PROBES);
    const supervisor = new SandboxSupervisor(config());
    await supervisor.register(
      spec("noworkers", files, {
        sandbox: { alwaysOn: true },
        report: (value) => {
          probes = value as Record<string, unknown>;
        },
      }),
    );
    await until(() => probes !== null, 20_000);
    await supervisor.shutdown();
    expect(probes).toMatchObject({
      plain: "ERR_ACCESS_DENIED",
      emptyArgv: "ERR_ACCESS_DENIED",
    });
  }, 40_000);
});

describe("methods that hand back a function", () => {
  it("give a plugin process a function it can call at once", async () => {
    const calls: string[] = [];
    let result: unknown = null;
    const body = `
      export async function activate(ctx) {
        const stop = ctx.hosts.trackSession(4);
        let out;
        try { stop(); out = typeof stop; } catch (error) { out = error.message; }
        await ctx.report(out);
      }`;
    const supervisor = new SandboxSupervisor(config());
    await supervisor.register(
      spec("tracker", plugin("tracker", body), {
        sandbox: { alwaysOn: true },
        report: (value) => {
          result = value;
        },
        ctx: {
          hosts: {
            trackSession: (hostId: number) => {
              calls.push(`open ${hostId}`);
              return () => calls.push(`close ${hostId}`);
            },
          },
        },
      }),
    );
    await until(() => result !== null);
    await until(() => calls.length === 2);
    await supervisor.shutdown();
    expect(result).toBe("function");
    expect(calls).toEqual(["open 4", "close 4"]);
  }, 30_000);
});

describe("asUser in a plugin process", () => {
  it("keeps what the callback returns or throws in the process", async () => {
    let result: unknown = null;
    const seen: string[] = [];
    const body = `
      class Box { constructor() { this.n = 1; } get() { return this.n; } }
      export async function activate(ctx) {
        const box = await ctx.asUser("u1", async () => new Box());
        class Oops extends Error {}
        let kept = false;
        try { await ctx.asUser("u1", async () => { throw new Oops("no"); }); }
        catch (error) { kept = error instanceof Oops; }
        await ctx.report({ same: box instanceof Box, n: box.get(), kept });
      }`;
    const supervisor = new SandboxSupervisor(config());
    await supervisor.register(
      spec("asuser", plugin("asuser", body), {
        sandbox: { alwaysOn: true },
        report: (value) => {
          result = value;
        },
        ctx: {
          asUser: async (userId: string, fn: () => unknown) => {
            seen.push(userId);
            return fn();
          },
        },
      }),
    );
    await until(() => result !== null);
    await supervisor.shutdown();
    expect(result).toEqual({ same: true, n: 1, kept: true });
    expect(seen).toEqual(["u1", "u1"]);
  }, 30_000);
});

describe("host providers in a plugin process", () => {
  it("keeps the plugin's host locks and follows changes", async () => {
    const providers: Array<{
      isLocked: (id: number) => boolean;
      note: (id: number) => string | null;
      allowManualCreate: () => boolean;
    }> = [];
    let result: unknown = null;
    const body = `
      export async function activate(ctx) {
        const locked = new Set([3]);
        ctx.hosts.locks.provide({
          isLocked: (id) => locked.has(id),
          note: (id) => (locked.has(id) ? "from hosts.yaml" : null),
          allowManualCreate: () => locked.size < 2,
          lockedHosts: () => [...locked],
        });
        setTimeout(() => locked.add(9), 200);
        let refused = null;
        try { ctx.hosts.locks.provide({ isLocked: () => true, note: () => null, allowManualCreate: () => true }); }
        catch (error) { refused = error.message; }
        await ctx.report({ refused });
      }`;
    const supervisor = new SandboxSupervisor(config());
    await supervisor.register(
      spec("locker", plugin("locker", body), {
        capabilities: ["hosts:lock"],
        report: (value) => {
          result = value;
        },
        ctx: {
          hosts: {
            locks: {
              provide: (provider: (typeof providers)[number]) => {
                providers.push(provider);
                return () => {};
              },
            },
          },
        },
      }),
    );
    await until(() => result !== null && providers.length === 1);
    expect(result).toEqual({
      refused: expect.stringMatching(/needs lockedHosts/),
    });
    const [provider] = providers;
    expect(provider.isLocked(3)).toBe(true);
    expect(provider.note(3)).toBe("from hosts.yaml");
    expect(provider.isLocked(9)).toBe(false);
    expect(provider.allowManualCreate()).toBe(true);
    await until(() => provider.isLocked(9), 5_000);
    expect(provider.allowManualCreate()).toBe(false);
    await supervisor.shutdown();
  }, 30_000);

  it("serves host status from a class instance across the process", async () => {
    let adapter: Record<string, (...a: unknown[]) => unknown> | null = null;
    const body = `
      class Service {
        constructor() { this.store = new Map([[1, { status: "online", lastChecked: "t1" }]]); this.ports = []; }
        start() {} stop() {}
        get(id) { return this.store.get(id) ?? null; }
        async statusesFor(userId, ids) {
          for (const resolve of this.ports) this.store.set(2, { status: "offline", lastChecked: String(await resolve(2)) });
          return this.store;
        }
        async refresh() {} async check(id) { return this.get(id); }
        reportLogin(id, outcome) { if (outcome.ok) this.store.set(id, { status: "online", lastChecked: "login" }); }
        registerPort(type, resolve) { this.ports.push(resolve); return () => { this.ports = []; }; }
        async getIntervalSeconds() { return 30; } async setIntervalSeconds() {}
      }
      export async function activate(ctx) { ctx.hosts.status.provide(new Service()); }`;
    const supervisor = new SandboxSupervisor(config());
    await supervisor.register(
      spec("statusp", plugin("statusp", body), {
        capabilities: ["hosts:status-provide"],
        ctx: {
          hosts: {
            status: {
              provide: (provider: typeof adapter) => {
                adapter = provider;
                return () => {};
              },
            },
          },
        },
      }),
    );
    await until(() => adapter !== null);
    const provider = adapter!;
    expect(provider.get(1)).toBeNull();
    await until(() => provider.get(1) !== null, 5_000);
    expect(provider.get(1)).toEqual({ status: "online", lastChecked: "t1" });
    provider.registerPort("ssh", async (id: number) => id * 11);
    await new Promise((r) => setTimeout(r, 100));
    const all = (await provider.statusesFor("u1", null)) as Map<
      number,
      unknown
    >;
    expect(all.get(2)).toEqual({ status: "offline", lastChecked: "22" });
    expect(provider.get(2)).toEqual({ status: "offline", lastChecked: "22" });
    provider.reportLogin(3, { ok: true });
    await until(() => {
      provider.get(3);
      return provider.get(3) !== null;
    }, 5_000);
    expect(await provider.getIntervalSeconds()).toBe(30);
    await supervisor.shutdown();
  }, 30_000);
});

describe("the sync provider in a plugin process", () => {
  it("answers /sync with core's sign in, cookies and change feed on the live request", async () => {
    const express = (await import("express")).default;
    let handle:
      ((req: unknown, res: unknown, next: () => void) => void) | null = null;
    const cookies: unknown[] = [];
    const listeners: string[] = [];
    let removed = 0;
    const reports: unknown[] = [];
    const remoteError = Object.assign(new Error("server said no"), {
      kind: "signed_out",
      status: 401,
    });
    const host = {
      embedded: false,
      info: { version: () => "26.11.2", appName: async () => "Termix" },
      entities: {
        list: () => [
          { type: "hosts", owner: "core", order: 1, readOnly: false },
        ],
        onChanged: () => () => {},
      },
      replica: {
        resolvers: (userId: string) => ({ userId }),
        loadRows: async (
          type: string,
          userId: string,
          resolvers: { userId: string },
        ) => ({
          rows: new Map([[`${type}:${userId}:${resolvers.userId}`, {}]]),
          failed: new Set(),
        }),
      },
      feed: {
        listen: async (userId: string, res: { write: (s: string) => void }) => {
          listeners.push(userId);
          res.write("event: change\n\n");
          return () => {
            removed++;
          };
        },
      },
      http: {
        json: async () => {
          throw remoteError;
        },
        isRemoteError: (error: unknown) => error === remoteError,
      },
      sessions: {
        middleware:
          () =>
          (
            req: Record<string, unknown>,
            res: { status: (c: number) => { json: (b: unknown) => void } },
            next: () => void,
          ) => {
            const auth = (req.headers as Record<string, string>).authorization;
            if (auth === "Bearer good") {
              req.userId = "u1";
              req.sessionId = "s1";
              next();
            } else
              res.status(401).json({ error: "Missing authentication token" });
          },
        setCookie: (
          _req: unknown,
          res: { cookie: (...a: unknown[]) => void },
          value: string,
          options: { name: string },
        ) => {
          cookies.push([options.name, value]);
          res.cookie(options.name, value);
        },
      },
      desktop: { deviceName: () => "desk" },
    };
    const body = `
      export async function activate(ctx) {
        const host = ctx.sync.host;
        const auth = host.sessions.middleware();
        const routes = {
          "/v2/info": [auth, (req, res) => {
            host.sessions.setCookie(req, res, "ring1", { name: "tmxp_syncp_ring" });
            res.json({ user: req.userId, session: req.sessionId, version: host.info.version(), device: host.desktop.deviceName(),
              embedded: host.embedded, types: host.entities.list().map((e) => e.type), cookies: req.cookies });
          }],
          "/v2/bad-cookie": [(req, res) => {
            host.sessions.setCookie(req, res, "x", { name: "termix_other" });
            setTimeout(() => res.json({ ok: true }), 50);
          }],
          "/v2/remote": [async (req, res) => {
            try { await host.http.json({ serverUrl: "https://x" }, "/p"); res.json({}); }
            catch (error) { res.json({ remote: host.http.isRemoteError(error), kind: error.kind, status: error.status }); }
          }],
          "/v2/rows": [async (req, res) => {
            const r = host.replica.resolvers("u2");
            const out = await host.replica.loadRows("t", "u2", r);
            res.json({ rows: [...out.rows.keys()], key: host.replica.records.key("a", "b") });
          }],
          "/v2/events": [auth, async (req, res) => {
            res.setHeader("Content-Type", "text/event-stream");
            res.write("event: ready\\n\\n");
            const stop = await host.feed.listen(req.userId, res);
            req.on("close", () => { stop(); ctx.report("req closed"); });
          }],
        };
        ctx.sync.provide({
          handle: (req, res, next) => {
            const chain = routes[req.url.split("?")[0]];
            if (!chain) return next();
            let i = 0;
            const step = () => { const fn = chain[i++]; if (fn) return fn(req, res, step); };
            step();
          },
        });
      }`;
    const supervisor = new SandboxSupervisor(config());
    await supervisor.register(
      spec("syncp", plugin("syncp", body), {
        capabilities: ["sync:provide"],
        report: (value) => {
          reports.push(value);
        },
        ctx: {
          sync: {
            host,
            provide: (provider: { handle: typeof handle }) => {
              handle = provider.handle;
              return () => {};
            },
          },
        },
      }),
    );
    await until(() => handle !== null);
    const app = express();
    app.use("/sync", (req, res, next) => handle!(req, res, next));
    app.use((_req, res) => res.status(404).json({ error: "none" }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/sync`;
    try {
      const refused = await fetch(`${base}/v2/info`);
      expect(refused.status).toBe(401);
      expect(await refused.json()).toEqual({
        error: "Missing authentication token",
      });

      const ok = await fetch(`${base}/v2/info`, {
        headers: {
          authorization: "Bearer good",
          cookie: "jwt=abc; termix_other=1; tmxp_syncp_ring=r0",
        },
      });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({
        user: "u1",
        session: "s1",
        version: "26.11.2",
        device: "desk",
        embedded: false,
        types: ["hosts"],
        cookies: { tmxp_syncp_ring: "r0", jwt: "abc" },
      });
      expect(cookies).toEqual([["tmxp_syncp_ring", "ring1"]]);
      expect(ok.headers.get("set-cookie")).toContain("tmxp_syncp_ring=ring1");

      const bad = await fetch(`${base}/v2/bad-cookie`);
      expect(bad.status).toBe(200);
      expect(cookies).toHaveLength(1);

      expect(await (await fetch(`${base}/v2/remote`)).json()).toEqual({
        remote: true,
        kind: "signed_out",
        status: 401,
      });
      expect(await (await fetch(`${base}/v2/rows`)).json()).toEqual({
        rows: ["t:u2:u2"],
        key: "a\u0000b",
      });
      expect((await fetch(`${base}/v2/missing`)).status).toBe(404);

      const controller = new AbortController();
      const events = await fetch(`${base}/v2/events`, {
        headers: { authorization: "Bearer good" },
        signal: controller.signal,
      });
      const reader = events.body!.getReader();
      let text = "";
      while (!text.includes("event: change")) {
        const { value } = await reader.read();
        text += new TextDecoder().decode(value);
      }
      expect(text).toBe("event: ready\n\nevent: change\n\n");
      expect(listeners).toEqual(["u1"]);
      controller.abort();
      await until(() => removed === 1 && reports.includes("req closed"), 5_000);
    } finally {
      server.close();
      await supervisor.shutdown();
    }
  }, 30_000);
});

describe("native addons", () => {
  it("load only with device:serial", async () => {
    const results: Record<string, string> = {};
    const body = `
      export async function activate(ctx) {
        let out;
        try { process.dlopen({ exports: {} }, "/no/such/addon.node"); out = "loaded"; }
        catch (error) { out = /sandboxed/.test(error.message) ? "refused" : "tried"; }
        await ctx.report(out);
      }`;
    const supervisor = new SandboxSupervisor(config());
    for (const [id, capabilities] of [
      ["addonyes", ["device:serial"]],
      ["addonno", []],
    ] as const) {
      await supervisor.register(
        spec(id, plugin(id, body), {
          capabilities: [...capabilities],
          sandbox: { alwaysOn: true },
          report: (value) => {
            results[id] = String(value);
          },
        }),
      );
    }
    await until(() => Object.keys(results).length === 2);
    await supervisor.shutdown();
    expect(results).toEqual({ addonyes: "tried", addonno: "refused" });
  }, 30_000);
});
