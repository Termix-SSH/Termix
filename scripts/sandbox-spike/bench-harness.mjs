// Sandbox spike measurements without the rest of core: one fake ctx, the
// real SandboxedPlugin host and child runtime from dist.
//
//   node bench-harness.mjs ssh <host> <user> [MiB=200]   SSH exec throughput, both directions
//   node bench-harness.mjs ipc [calls=20000]             ctx call round trip
//   node bench-harness.mjs scale <count>                 boot time and memory for N plugins
//
// Each run prints in-process and sandboxed numbers side by side.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const require = createRequire(path.join(root, "package.json"));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "termix-sandbox-bench-"));
process.env.DATA_DIR = path.join(work, "data");
const { SandboxedPlugin } = await import(
  pathToFileURL(path.join(root, "dist/backend/backend/plugins/sandbox/host.js"))
    .href
);

const PLUGIN = `
export async function activate(ctx) {
  ctx.bench.register({
    async ssh(bytes) {
      const conn = await ctx.ssh.connect(1);
      const started = performance.now();
      let received = 0;
      await new Promise((resolve, reject) =>
        conn.client.exec("head -c " + bytes + " /dev/zero", (err, stream) => {
          if (err) return reject(err);
          stream.on("data", (d) => (received += d.length));
          stream.stderr.on("data", () => {});
          stream.on("close", resolve);
        }),
      );
      const downMs = performance.now() - started;
      const upStart = performance.now();
      await new Promise((resolve, reject) =>
        conn.client.exec("cat > /dev/null", (err, stream) => {
          if (err) return reject(err);
          const chunk = Buffer.alloc(64 * 1024, 97);
          let sent = 0;
          const pump = () => {
            while (sent < bytes) {
              sent += chunk.length;
              if (!stream.write(chunk)) return stream.once("drain", pump);
            }
            stream.end();
          };
          stream.on("close", resolve);
          // Unread stdout keeps the channel open forever.
          stream.resume();
          stream.stderr.on("data", () => {});
          pump();
        }),
      );
      const upMs = performance.now() - upStart;
      conn.dispose();
      return { received, downMs, upMs };
    },
    async ipc(calls) {
      const started = performance.now();
      for (let i = 0; i < calls; i++) await ctx.bench.echo(i);
      return (performance.now() - started) / calls;
    },
  });
}
`;
const NOOP = `export async function activate(ctx) { ctx.bench.register({}); }`;

function pluginDir(id, code) {
  const dir = path.join(work, "plugins", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.mjs"), code);
  return dir;
}

function makeCtx(sshTarget) {
  let impl = null;
  const ctx = {
    pluginId: "bench",
    bench: {
      register: (value) => {
        impl = value;
      },
      echo: async (x) => x,
    },
    ssh: {
      connect: async () => {
        const { Client } = require("ssh2");
        const client = new Client();
        await new Promise((resolve, reject) => {
          client.once("ready", resolve);
          client.once("error", reject);
          client.connect({
            host: sshTarget.host,
            username: sshTarget.user,
            password: process.env.BENCH_SSH_PASSWORD,
            tryKeyboard: true,
          });
        });
        return {
          client,
          host: { ip: sshTarget.host },
          dispose: () => client.end(),
        };
      },
    },
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
  return { ctx, impl: () => impl };
}

async function inProcess(code, sshTarget) {
  const dir = pluginDir(`inproc-${Math.random().toString(36).slice(2)}`, code);
  const { ctx, impl } = makeCtx(sshTarget);
  const mod = await import(pathToFileURL(path.join(dir, "index.mjs")).href);
  await mod.activate(ctx);
  return impl();
}

async function sandboxed(id, code, sshTarget) {
  const dir = pluginDir(id, code);
  const { ctx, impl } = makeCtx(sshTarget);
  const plugin = new SandboxedPlugin(
    { id, capabilities: [] },
    dir,
    path.join(dir, "index.mjs"),
    ctx,
  );
  await plugin.start();
  return { plugin, impl: impl() };
}

const [mode, ...rest] = process.argv.slice(2);
const mib = (bytes, ms) => +(bytes / 1024 / 1024 / (ms / 1000)).toFixed(1);

try {
  if (mode === "ssh") {
    const [host, user, sizeArg] = rest;
    const bytes = Number(sizeArg ?? 200) * 1024 * 1024;
    const target = { host, user };
    for (const [label, getImpl] of [
      ["in process", async () => inProcess(PLUGIN, target)],
      [
        "sandboxed",
        async () => (await sandboxed("ssh-bench", PLUGIN, target)).impl,
      ],
    ]) {
      const impl = await getImpl();
      for (let run = 0; run < 2; run++) {
        const r = await impl.ssh(bytes);
        console.log(
          JSON.stringify({
            mode: label,
            run,
            downMiBps: mib(r.received, r.downMs),
            upMiBps: mib(bytes, r.upMs),
            received: r.received,
          }),
        );
      }
    }
  } else if (mode === "ipc") {
    const calls = Number(rest[0] ?? 20000);
    const local = await inProcess(PLUGIN, {});
    console.log(
      JSON.stringify({
        mode: "in process",
        usPerCall: +((await local.ipc(calls)) * 1000).toFixed(1),
      }),
    );
    const { impl } = await sandboxed("ipc-bench", PLUGIN, {});
    await impl.ipc(1000);
    console.log(
      JSON.stringify({
        mode: "sandboxed",
        usPerCall: +((await impl.ipc(calls)) * 1000).toFixed(1),
      }),
    );
  } else if (mode === "scale") {
    const count = Number(rest[0] ?? 15);
    const before = process.memoryUsage().rss;
    const started = performance.now();
    const plugins = [];
    // Started in parallel batches of 8, the way a boot could do it.
    for (let i = 0; i < count; i += 8) {
      const batch = [];
      for (let j = i; j < Math.min(count, i + 8); j++)
        batch.push(sandboxed(`noop-${j}`, NOOP, {}));
      plugins.push(...(await Promise.all(batch)));
    }
    const bootMs = performance.now() - started;
    const times = plugins.map(
      ({ plugin }) => plugin.readyAt - plugin.startedAt,
    );
    let rss = 0;
    let pss = 0;
    for (const { plugin } of plugins) {
      rss += (await plugin.endpoint.call("stats", [])).rss;
      // Linux: proportional set size counts shared pages once.
      try {
        const rollup = fs.readFileSync(
          `/proc/${plugin.child.pid}/smaps_rollup`,
          "utf8",
        );
        pss += Number(/^Pss:\s+(\d+)/m.exec(rollup)[1]) * 1024;
      } catch {
        // not Linux
      }
    }
    // One ctx round trip on each, all at once, as a busy server would see.
    const t = performance.now();
    await Promise.all(
      plugins.map(({ plugin }) => plugin.endpoint.call("stats", [])),
    );
    const fanoutMs = performance.now() - t;
    console.log(
      JSON.stringify({
        plugins: count,
        bootMs: Math.round(bootMs),
        startP50: Math.round(
          times.sort((a, b) => a - b)[Math.floor(count / 2)],
        ),
        childRssTotalMiB: Math.round(rss / 1024 / 1024),
        childRssEachMiB: +(rss / count / 1024 / 1024).toFixed(1),
        childPssEachMiB: pss
          ? +(pss / count / 1024 / 1024).toFixed(1)
          : undefined,
        hostRssDeltaMiB: Math.round(
          (process.memoryUsage().rss - before) / 1024 / 1024,
        ),
        fanoutMs: +fanoutMs.toFixed(1),
      }),
    );
    await Promise.all(plugins.map(({ plugin }) => plugin.stop()));
  } else {
    console.log("mode: ssh | ipc | scale");
  }
} finally {
  setTimeout(() => {
    fs.rmSync(work, { recursive: true, force: true });
    process.exit(0);
  }, 300);
}
