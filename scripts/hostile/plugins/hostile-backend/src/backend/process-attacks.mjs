// Attacks on the process itself: files, processes, modules, sockets and the
// environment. The fixture runs them from its routes; the desktop fence
// test bundles this file and runs them in the packaged app's sandbox.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function describe(error) {
  if (!error) return "";
  const code = error.code ? `${error.code} ` : "";
  return `${code}${error.message ?? String(error)}`.slice(0, 500);
}

export function short(value) {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return String(text).slice(0, 2000);
  } catch {
    return String(value).slice(0, 2000);
  }
}

/** Runs fn: a throw is a refusal, a value means it worked. */
export async function attempt(fn) {
  try {
    const value = await fn();
    return { worked: true, detail: short(value) };
  } catch (error) {
    return { worked: false, detail: describe(error) };
  }
}

export function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Resolves once a socket connects, rejects on its error. */
function connected(socket) {
  return new Promise((resolve, reject) => {
    socket.once("connect", () => {
      socket.destroy();
      resolve("connected");
    });
    socket.once("error", reject);
  });
}

function builtin(name) {
  return process.getBuiltinModule(name);
}

/** id -> (input) => { worked, detail }. `own` is the plugin's data folder. */
export function processAttacks(own) {
  return {
    // ---- files ----
    "fs.read-data-dir": (input) => attempt(() => fs.readdirSync(input.dataDir)),
    "fs.read-canary": (input) =>
      attempt(() => fs.readFileSync(input.canaryFile, "utf8")),
    "fs.read-data-files": (input) =>
      attempt(() => {
        const read = [];
        for (const file of input.dataFiles ?? []) {
          try {
            fs.readFileSync(file);
            read.push(file);
          } catch {
            // refused, as it should be
          }
        }
        if (read.length === 0) throw new Error("no file could be read");
        return read;
      }),
    "fs.read-victim": (input) =>
      attempt(() =>
        fs.readFileSync(path.join(input.victimDir, "secret.txt"), "utf8"),
      ),
    "fs.read-victim-dotdot": (input) =>
      attempt(() => {
        const rel = path.relative(
          own,
          path.join(input.victimDir, "secret.txt"),
        );
        return fs.readFileSync(`${own}/${rel.replaceAll("\\", "/")}`, "utf8");
      }),
    "fs.symlink-escape": (input) =>
      attempt(() => {
        const link = path.join(own, `link-${Date.now()}`);
        fs.symlinkSync(input.dataDir, link, "junction");
        try {
          return fs.readdirSync(link);
        } finally {
          fs.rmSync(link, { force: true, recursive: false });
        }
      }),
    "fs.write-data-dir": (input) =>
      attempt(() => {
        const file = path.join(input.dataDir, "hostile-escape.txt");
        fs.writeFileSync(file, "x");
        return file;
      }),
    "fs.write-victim": (input) =>
      attempt(() => {
        const file = path.join(input.victimDir, "secret.txt");
        fs.appendFileSync(file, "x");
        return file;
      }),
    "fs.write-tmp": () =>
      attempt(() => {
        const file = path.join(
          os.tmpdir(),
          `hostile-escape-${process.pid}.txt`,
        );
        fs.writeFileSync(file, "x");
        fs.rmSync(file, { force: true });
        return file;
      }),
    "fs.write-core": (input) =>
      attempt(() => {
        const file = path.join(input.coreRoot, "hostile-escape.txt");
        fs.writeFileSync(file, "x");
        return file;
      }),
    "fs.own-control": () =>
      attempt(() => {
        const file = path.join(own, "own.txt");
        fs.writeFileSync(file, "mine");
        return fs.readFileSync(file, "utf8");
      }),
    "env.read": (input) =>
      attempt(() => {
        const env = Object.entries(process.env);
        const canary = env.filter(([, value]) =>
          String(value).includes(input.envCanary),
        );
        const secretNames = env
          .map(([name]) => name)
          .filter((name) =>
            /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|JWT|DATA_DIR|NODE_OPTIONS/i.test(
              name,
            ),
          );
        if (canary.length === 0 && secretNames.length === 0) {
          throw new Error("nothing sensitive in the environment");
        }
        return { canary: canary.map(([name]) => name), secretNames };
      }),

    // ---- processes and modules ----
    "proc.spawn": () =>
      attempt(() => {
        const result = builtin("node:child_process").spawnSync(
          process.execPath,
          ["-e", "1"],
        );
        if (result.error) throw result.error;
        return `exit ${result.status}`;
      }),
    "proc.exec": () =>
      attempt(() =>
        builtin("node:child_process").execSync("echo hostile").toString(),
      ),
    "proc.worker-file": () =>
      attempt(() => {
        const file = path.join(own, "worker.mjs");
        fs.writeFileSync(file, "export {};\n");
        const { Worker } = builtin("node:worker_threads");
        const worker = new Worker(file);
        void worker.terminate();
        return "worker started";
      }),
    "proc.worker-eval": () =>
      attempt(() => {
        const { Worker } = builtin("node:worker_threads");
        const worker = new Worker("1", { eval: true });
        void worker.terminate();
        return "worker started";
      }),
    "proc.dlopen": () =>
      attempt(() => {
        const file = path.join(own, "fake.node");
        fs.writeFileSync(file, "not an addon");
        process.dlopen({ exports: {} }, file);
        return "loaded";
      }),
    "proc.binding": () => attempt(() => Object.keys(process.binding("fs"))),
    "proc.linked-binding": () =>
      attempt(() => process._linkedBinding("hostile")),
    "proc.debug-parent": () =>
      attempt(() => {
        process._debugProcess(process.ppid);
        return "inspector opened";
      }),
    "proc.signal-parent": () =>
      attempt(() => {
        // Signal 0 only checks that the signal could be sent.
        process.kill(process.ppid, 0);
        return `could signal ${process.ppid}`;
      }),
    "proc.signal-parent-internal": () =>
      attempt(() => {
        if (typeof process._kill !== "function") {
          throw new Error("no internal kill");
        }
        const code = process._kill(process.ppid, 0);
        if (code) throw new Error(`errno ${code}`);
        return `could signal ${process.ppid}`;
      }),
    "proc.priority-parent": () =>
      attempt(() => {
        const current = os.getPriority(process.ppid);
        os.setPriority(process.ppid, current);
        return `could set priority of ${process.ppid}`;
      }),
    "mod.sqlite": () => attempt(() => import("node:sqlite").then(Object.keys)),
    "mod.sqlite-require": () =>
      attempt(() => Object.keys(require("node:sqlite"))),
    "mod.sqlite-builtin": () =>
      attempt(() => Object.keys(process.getBuiltinModule("node:sqlite"))),
    "mod.inspector": () =>
      attempt(() => import("node:inspector").then(Object.keys)),
    "mod.wasi": () => attempt(() => import("node:wasi").then(Object.keys)),
    "mod.trace-events": () =>
      attempt(() => import("node:trace_events").then(Object.keys)),

    // ---- network without network:sockets ----
    "net.tcp": (input) =>
      attempt(() =>
        withTimeout(
          connected(builtin("node:net").connect(input.listenPort, "127.0.0.1")),
          4000,
          "tcp",
        ),
      ),
    "net.udp": (input) =>
      attempt(
        () =>
          new Promise((resolve, reject) => {
            const socket = builtin("node:dgram").createSocket("udp4");
            socket.once("error", reject);
            socket.send("hostile", input.listenPort, "127.0.0.1", (error) => {
              socket.close();
              if (error) reject(error);
              else resolve("sent");
            });
          }),
      ),
    "net.dns": () =>
      attempt(() =>
        builtin("node:dns").promises.lookup("localhost").then(short),
      ),
    "net.http": (input) =>
      attempt(
        () =>
          new Promise((resolve, reject) => {
            const request = builtin("node:http").get(
              `http://127.0.0.1:${input.listenPort}/`,
              (response) => {
                response.resume();
                resolve(`status ${response.statusCode}`);
              },
            );
            request.once("error", reject);
            request.setTimeout(4000, () =>
              request.destroy(new Error("timeout")),
            );
          }),
      ),
    "net.global-fetch": (input) =>
      attempt(() =>
        withTimeout(
          globalThis.fetch(`http://127.0.0.1:${input.listenPort}/`),
          4000,
          "fetch",
        ).then((response) => `status ${response.status}`),
      ),
    "net.global-websocket": (input) =>
      attempt(
        () =>
          new Promise((resolve, reject) => {
            if (typeof globalThis.WebSocket !== "function") {
              reject(new Error("no WebSocket"));
              return;
            }
            const ws = new globalThis.WebSocket(
              `ws://127.0.0.1:${input.listenPort}/`,
            );
            const timer = setTimeout(() => reject(new Error("timeout")), 4000);
            ws.onopen = () => {
              clearTimeout(timer);
              ws.close();
              resolve("open");
            };
            ws.onerror = () => {
              clearTimeout(timer);
              reject(new Error("socket error"));
            };
          }),
      ),
  };
}
