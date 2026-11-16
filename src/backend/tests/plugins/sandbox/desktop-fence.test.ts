/**
 * The desktop path for real: Electron main's sandbox host starts the app's
 * pinned Node inside the OS sandbox helper, and the supervisor talks to it
 * through the electron relay. Only Electron's MessageChannel is faked.
 *
 * Needs the runtime built (npm run plugin-runtime). Two layers, each checked
 * on its own: the Node permission model, and the OS fence with Node's flags
 * left off. CI sets TERMIX_REQUIRE_PLUGIN_RUNTIME=1 so a missing runtime
 * fails instead of skipping, and TERMIX_FENCE_RESOURCES to a packaged app's
 * resources folder to check the files that ship (signed on release builds).
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../plugins/permissions.js", () => ({
  hasCapability: async (_id: string, capability: string, declared: string[]) =>
    declared.includes(capability),
}));
const logged = vi.hoisted(() => [] as string[]);
vi.mock("../../../utils/logger.js", () => {
  const keep = (text: string) => void logged.push(String(text));
  return {
    pluginLogger: {
      info: keep,
      warn: keep,
      error: keep,
      debug: keep,
      success: keep,
    },
  };
});

import { SandboxSupervisor } from "../../../plugins/sandbox/supervisor.js";
import { relaySpawner, setSpawner } from "../../../plugins/sandbox/spawn.js";
import { setParentTarget } from "../../../utils/parent-channel.js";
import * as frames from "../../../plugins/sandbox/frames.js";
import * as policy from "../../../plugins/sandbox/launcher/policy.js";
import {
  createPluginHandle,
  disposePluginHandle,
} from "../../../plugins/ctx.js";

const require = createRequire(import.meta.url);
const repo = path.resolve(__dirname, "../../../../..");
const { createPluginSandboxHost } = require(
  path.join(repo, "electron", "plugin-sandbox.cjs"),
);
const { checkRuntime } = require(
  path.join(repo, "electron", "plugin-runtime.cjs"),
);

// Electron hands the app an absolute resources path; CI passes a relative one.
const packaged = process.env.TERMIX_FENCE_RESOURCES
  ? path.resolve(process.env.TERMIX_FENCE_RESOURCES)
  : undefined;
const runtimeInfo = checkRuntime(
  packaged
    ? {
        isPackaged: true,
        resourcesPath: packaged,
        appBundle: process.env.TERMIX_FENCE_APP
          ? path.resolve(process.env.TERMIX_FENCE_APP)
          : null,
      }
    : { isPackaged: false, appRoot: repo },
);
const built = !runtimeInfo.error;
if (process.env.TERMIX_REQUIRE_PLUGIN_RUNTIME === "1" && !built) {
  throw new Error(`plugin runtime: ${runtimeInfo.error}`);
}
const win = process.platform === "win32";

/** Windows names, looked up without caring about case (the test env may not). */
function winEnv(): Record<string, string> {
  if (!win) return {};
  const find = (name: string) =>
    Object.entries(process.env).find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    )?.[1] ?? "";
  return {
    SystemRoot: find("SystemRoot"),
    windir: find("windir"),
    LOCALAPPDATA: find("LOCALAPPDATA"),
  };
}

// Windows only grants low integrity reads outside the scratch area the
// test runner may sit in, so the work folder lives in the OS temp folder.
let work: string;
let backendDir: string;
let dataRoot: string;
let secretFile: string;

beforeAll(async () => {
  if (!built) return;
  // The real path: macOS's temp folder sits behind the /var link, which an
  // installed app's paths never do.
  work = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "tmx-desktop-fence-")),
  );
  // The packaged layout: dist/backend/package.json, code in dist/backend/backend.
  backendDir = path.join(work, "dist-backend", "backend");
  const child = path.join(backendDir, "plugins", "sandbox", "child");
  const esbuild = await import("esbuild");
  const src = path.join(repo, "src", "backend", "plugins", "sandbox", "child");
  await esbuild.build({
    entryPoints: {
      runtime: path.join(src, "runtime.ts"),
      harden: path.join(src, "harden.ts"),
    },
    outdir: child,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    // Bundled whole, so the plugin process needs no node_modules.
    external: ["cpu-features", "*.node"],
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    logLevel: "silent",
  });
  fs.writeFileSync(
    path.join(backendDir, "..", "package.json"),
    '{"type":"module"}',
  );
  dataRoot = path.join(work, "data");
  fs.mkdirSync(dataRoot, { recursive: true });
  secretFile = path.join(dataRoot, "db.sqlite.encrypted");
  fs.writeFileSync(secretFile, "not for plugins");
  process.env.DATA_DIR = dataRoot;
  process.env.ELECTRON_EMBEDDED = "true";
  process.env.TERMIX_PLUGIN_NODE_MAJOR = String(runtimeInfo.version).split(
    ".",
  )[0];
}, 120_000);

afterAll(() => {
  setSpawner(null);
  setParentTarget(null);
  delete process.env.ELECTRON_EMBEDDED;
  delete process.env.TERMIX_PLUGIN_NODE_MAJOR;
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

class Port extends EventEmitter {
  other!: Port;
  postMessage(data: unknown) {
    setImmediate(() => this.other.emit("message", { data }));
  }
  start() {}
  close() {}
}

class MessageChannelMain {
  port1 = new Port();
  port2 = new Port();
  constructor() {
    this.port1.other = this.port2;
    this.port2.other = this.port1;
  }
}

/** Wires the backend's parent channel to the real Electron main host. */
function desktop() {
  const toBackend = new EventEmitter();
  const host = createPluginSandboxHost({
    MessageChannelMain,
    backendDir,
    dataRoot,
    getRuntime: () => runtimeInfo,
    env: winEnv(),
    loadPolicy: () => policy,
    loadFrames: () => frames,
  });
  const backend = {
    postMessage: (message: unknown, transfer: unknown[]) =>
      setImmediate(() =>
        toBackend.emit("message", { data: message, ports: transfer }),
      ),
  };
  setParentTarget({
    parentPort: {
      postMessage: (message: unknown) => host.handle(message, backend),
      on: (event, listener) => toBackend.on(event, listener),
      off: (event, listener) => toBackend.off(event, listener),
    },
    on: () => undefined,
    off: () => undefined,
  });
  setSpawner(relaySpawner("electron"));
  return host;
}

function plugin(id: string, body: string) {
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
  report: (value: unknown) => void,
  capabilities: string[] = [],
) {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      capabilities,
      engine: { api: "^2.0.0", termix: "*" },
      sandbox: { alwaysOn: true },
    } as never,
    dir: entry.dir,
    entryPath: entry.entry,
    makeContext: () => {
      const handle = createPluginHandle(id, { activate: () => undefined });
      const ctx = {
        pluginId: id,
        report: async (value: unknown) => report(value),
        log: { info() {}, warn() {}, error() {}, debug() {} },
      };
      return { ctx, handle };
    },
    disposeHandle: (handle: ReturnType<typeof createPluginHandle>) =>
      disposePluginHandle(handle, id, { runDeactivate: false }),
    onFailed: () => {},
  };
}

const until = async (check: () => boolean, ms = 30_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

/** Each probe reports "open" or the error code it hit. */
function probes(secret: string, outside: string) {
  return `
import fs from "node:fs";
const tryIt = async (fn) => {
  try { await fn(); return "open"; }
  catch (error) { return error.code ?? error.message; }
};
// Node raises some network denials on a later tick, outside any handler.
const guarded = (body) => new Promise((resolve, reject) => {
  const fail = (error) => { process.off("uncaughtException", fail); reject(error); };
  process.on("uncaughtException", fail);
  const done = (value) => { process.off("uncaughtException", fail); resolve(value); };
  import("node:net").then((net) => {
    try { body(net, done, fail); } catch (error) { fail(error); }
  }, fail);
});
export async function run() {
  const out = {};
  out.readSecret = await tryIt(() => fs.readFileSync(${JSON.stringify(secret)}));
  out.writeOutside = await tryIt(() => fs.writeFileSync(${JSON.stringify(outside)}, "x"));
  out.spawn = await tryIt(async () => {
    const r = (await import("node:child_process")).spawnSync(process.execPath, ["-v"], { stdio: "ignore" });
    if (r.error) throw r.error;
    if (r.status !== 0) throw Object.assign(new Error("refused"), { code: "STATUS_" + r.status });
  });
  out.socket = await tryIt(() => guarded((net, resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => server.close(() => resolve()));
  }));
  // Outbound is what the OS fences everywhere (an AppContainer may still
  // bind a loopback port; nothing can reach it from outside).
  out.connect = await tryIt(() => guarded((net, resolve, reject) => {
    const socket = net.connect(80, "1.1.1.1");
    socket.setTimeout(3000, () => { socket.destroy(); resolve(); });
    socket.on("connect", () => { socket.destroy(); resolve(); });
    socket.on("error", (error) => ["EACCES", "EPERM", "ERR_ACCESS_DENIED"].includes(error.code) ? reject(error) : resolve());
  }));
  return out;
}
`;
}

describe.runIf(built)("desktop plugin fence (packaged runtime)", () => {
  it("runs plugins on the pinned Node with the permission model on", async () => {
    const supervisor = new SandboxSupervisor({
      idleMs: 60_000,
      cpuPercent: 95,
      memoryMb: 128,
      alwaysOn: new Set(),
      healthIntervalMs: 500,
      healthTimeoutMs: 5000,
      cpuWindowMs: 2000,
      backoffStartMs: 50,
      paths: {
        runtime: path.join(
          backendDir,
          "plugins",
          "sandbox",
          "child",
          "runtime.js",
        ),
        harden: path.join(
          backendDir,
          "plugins",
          "sandbox",
          "child",
          "harden.js",
        ),
        reads: [],
      },
    });
    desktop();
    const outside = path.join(work, "escape.txt");
    let result: Record<string, unknown> | null = null;
    const files = plugin(
      "fence-probe",
      probes(secretFile, outside) +
        `export async function activate(ctx) {
          const out = await run();
          out.version = process.version;
          out.permission = typeof process.permission;
          await ctx.report(out);
        }`,
    );
    // The plugin's own output says why it did not start.
    await supervisor
      .register(
        spec("fence-probe", files, (value) => {
          result = value as Record<string, unknown>;
        }),
      )
      .catch((error: Error) => {
        throw new Error([error.message, ...logged].join("\n"));
      });
    await until(() => result !== null);
    await supervisor.shutdown();
    expect(result).toMatchObject({
      version: expect.stringMatching(new RegExp(`^v${runtimeInfo.version}$`)),
      permission: "object",
      readSecret: "ERR_ACCESS_DENIED",
      writeOutside: "ERR_ACCESS_DENIED",
      spawn: "ERR_ACCESS_DENIED",
      socket: "ERR_ACCESS_DENIED",
      connect: "ERR_ACCESS_DENIED",
    });
    expect(fs.existsSync(outside)).toBe(false);
  }, 120_000);

  // The hostile suite's attacks on the process itself (scripts/hostile),
  // run in the packaged app's sandbox. Everything else it tries goes through
  // ctx and core, the same code the server suite covers.
  it("refuses the hostile suite's process attacks", async () => {
    const supervisor = new SandboxSupervisor({
      idleMs: 60_000,
      cpuPercent: 95,
      memoryMb: 256,
      alwaysOn: new Set(),
      healthIntervalMs: 500,
      healthTimeoutMs: 5000,
      cpuWindowMs: 2000,
      backoffStartMs: 50,
      paths: {
        runtime: path.join(
          backendDir,
          "plugins",
          "sandbox",
          "child",
          "runtime.js",
        ),
        harden: path.join(
          backendDir,
          "plugins",
          "sandbox",
          "child",
          "harden.js",
        ),
        reads: [],
      },
    });
    desktop();
    const files = plugin("hostile-process", "");
    const esbuild = await import("esbuild");
    await esbuild.build({
      entryPoints: [
        path.join(
          repo,
          "scripts/hostile/plugins/hostile-backend/src/backend/process-attacks.mjs",
        ),
      ],
      outfile: path.join(files.dir, "attacks.js"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      logLevel: "silent",
    });
    const victimDir = path.join(dataRoot, "plugin-data", "hostile-victim");
    fs.mkdirSync(victimDir, { recursive: true });
    fs.writeFileSync(path.join(victimDir, "secret.txt"), "victim secret");
    const target = (await import("node:net")).createServer((socket) =>
      socket.end(),
    );
    await new Promise<void>((resolve) =>
      target.listen(0, "127.0.0.1", resolve),
    );
    const input = {
      dataDir: dataRoot,
      canaryFile: secretFile,
      dataFiles: [secretFile],
      victimDir,
      coreRoot: path.dirname(backendDir),
      listenPort: (target.address() as { port: number }).port,
      envCanary: "hostile-env-canary",
    };
    fs.writeFileSync(
      files.entry,
      `import { processAttacks } from "./attacks.js";
       export async function activate(ctx) {
         const attacks = processAttacks(${JSON.stringify(
           path.join(dataRoot, "plugin-data", "hostile-process"),
         )});
         const out = {};
         for (const [id, run] of Object.entries(attacks)) {
           out[id] = await run(${JSON.stringify(input)});
         }
         await ctx.report(out);
       }`,
    );
    process.env.TERMIX_HOSTILE_CANARY = input.envCanary;
    let result: Record<string, { worked: boolean; detail?: string }> | null =
      null;
    try {
      await supervisor
        .register(
          spec(
            "hostile-process",
            files,
            (value) => {
              result = value as typeof result;
            },
            ["files:own"],
          ),
        )
        .catch((error: Error) => {
          throw new Error([error.message, ...logged].join("\n"));
        });
      await until(() => result !== null, 90_000);
    } finally {
      await supervisor.shutdown();
      target.close();
      delete process.env.TERMIX_HOSTILE_CANARY;
    }
    const { evaluate } =
      await import("../../../../../scripts/hostile/lib/evaluate.mjs");
    const { BACKEND } =
      await import("../../../../../scripts/hostile/lib/expect.mjs");
    const rows = evaluate(result!, BACKEND, {
      channel: "stdio",
      required: Object.keys(result!),
    }) as Array<{ id: string; status: string; why: string; detail?: string }>;
    const failed = rows.filter((row) => row.status === "fail");
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(rows.length).toBeGreaterThan(30);
    expect(fs.readFileSync(path.join(victimDir, "secret.txt"), "utf8")).toBe(
      "victim secret",
    );
  }, 180_000);

  /** Runs a probe script in the helper with Node's flags left off. */
  function jailOnly(
    script: string,
    grants: { net?: boolean; childProcess?: boolean; memoryMb?: number } = {},
    extraArgs: string[] = [],
  ) {
    const dir = path.join(work, "jail-only");
    const data = path.join(dataRoot, "plugin-data", "jail-only");
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(dir, "probe.mjs"), script);
    const jailPolicy = {
      name: "jail-only",
      read: [dir],
      write: [data],
      net: grants.net ?? false,
      childProcess: grants.childProcess ?? false,
      addons: false,
      memoryMb: grants.memoryMb ?? 512,
    };
    const args = [
      JSON.stringify(jailPolicy),
      "--",
      runtimeInfo.node,
      ...(win ? ["--preserve-symlinks", "--preserve-symlinks-main"] : []),
      path.join(dir, "probe.mjs"),
      ...extraArgs,
    ];
    return new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve) => {
        const child = spawn(runtimeInfo.jail, args, {
          cwd: data,
          env: winEnv(),
          windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        child.on("exit", (code) => resolve({ code, stdout, stderr }));
      },
    );
  }

  it("keeps the OS fence when Node's flags are left off", async () => {
    const outside = path.join(work, "escape-os.txt");
    const run = await jailOnly(
      probes(secretFile, outside) +
        `console.log(JSON.stringify({ ...(await run()), permission: typeof process.permission }));`,
    );
    expect(run.code, run.stderr).toBe(0);
    const out = JSON.parse(run.stdout.trim().split("\n").pop()!);
    expect(out.permission).toBe("undefined");
    // A Linux kernel without Landlock (before 5.13, or turned off) leaves
    // files to Node's rules; the helper says so and the docs list it.
    const noLandlock = /no Landlock/.test(run.stderr);
    const checked = noLandlock
      ? ["spawn", "connect"]
      : ["readSecret", "writeOutside", "spawn", "connect"];
    for (const probe of checked) {
      expect(out[probe], probe).not.toBe("open");
    }
    if (!noLandlock) expect(fs.existsSync(outside)).toBe(false);
  }, 60_000);

  it("stops a process that grows past its memory cap", async () => {
    const run = await jailOnly(
      `const keep = []; setInterval(() => keep.push(Buffer.alloc(32 * 1024 * 1024, 1)), 10);`,
      { memoryMb: 256 },
    );
    expect(run.code, run.stderr).toBe(86);
    expect(run.stderr).toMatch(/memory limit of 256 MB/);
  }, 60_000);

  it("lets a plugin with network:sockets open a socket", async () => {
    const run = await jailOnly(
      probes(secretFile, path.join(work, "x")) +
        `console.log(JSON.stringify(await run()));`,
      { net: true },
    );
    expect(run.code, run.stderr).toBe(0);
    const out = JSON.parse(run.stdout.trim().split("\n").pop()!);
    expect(out.socket).toBe("open");
  }, 60_000);
});
