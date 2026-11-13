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
    const supervisor = new SandboxSupervisor(config({ cpuPercent: 25 }));
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
    await until(() => starts >= 2, 15_000);
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
    );
    expect(env).toEqual({
      NODE_ENV: "production",
      TERMIX_SANDBOX_PLUGIN: "snippets",
      SNIPPET_EXECUTION_TIMEOUT_SECONDS: "60",
    });
  });
});
