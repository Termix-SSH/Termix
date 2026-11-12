// Runs inside a sandboxed plugin child and tries every way out we know of.
// Prints one JSON line: [{ probe, outcome: "blocked" | "open", detail }].
import fs from "node:fs";
import net from "node:net";
import dgram from "node:dgram";
import dns from "node:dns/promises";
import { createRequire } from "node:module";

const cfg = JSON.parse(process.argv[2]);
const require = createRequire(import.meta.url);
const results = [];

function denied(error) {
  return (
    error?.code === "ERR_ACCESS_DENIED" ||
    error?.code === "ERR_DLOPEN_DISABLED" ||
    /ERR_ACCESS_DENIED|Access to this API has been restricted/.test(
      String(error?.message ?? error),
    )
  );
}

// Some denials surface as an uncaught throw on the next tick (listen on Node 26).
let failCurrent = null;
process.on("uncaughtException", (error) => failCurrent?.(error));

async function probe(name, fn) {
  try {
    const detail = await Promise.race([
      fn(),
      new Promise((_, reject) => (failCurrent = reject)),
    ]);
    results.push({
      probe: name,
      outcome: "open",
      detail: String(detail ?? ""),
    });
  } catch (error) {
    results.push({
      probe: name,
      outcome: denied(error) ? "blocked" : "error",
      detail: `${error?.code ?? ""} ${String(error?.message ?? error).slice(0, 120)}`,
    });
  }
}

const withTimeout = (promise, ms = 3000) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);

await probe(
  "read db file",
  () => fs.readFileSync(cfg.dbFile).length + " bytes",
);
await probe(
  "read system key",
  () => fs.readFileSync(cfg.keyFile).length + " bytes",
);
await probe(
  "read core .env",
  () => fs.readFileSync(cfg.envFile).length + " bytes",
);
await probe("list data dir", () => fs.readdirSync(cfg.dataDir).join(","));
await probe(
  "read own plugin dir",
  () => fs.readdirSync(cfg.pluginDir).length + " entries",
);
await probe("write own data dir", () => {
  fs.writeFileSync(`${cfg.ownDataDir}/ok.txt`, "x");
  return "wrote";
});
await probe("write outside data dir", () => {
  fs.writeFileSync(`${cfg.dataDir}/pwned.txt`, "x");
  return "wrote";
});
await probe("symlink in plugin dir to db", () =>
  fs.existsSync(cfg.symlink)
    ? fs.readFileSync(cfg.symlink).length + " bytes"
    : "no symlink made",
);
await probe("create symlink to db", () => {
  fs.symlinkSync(cfg.dbFile, `${cfg.ownDataDir}/link`);
  return fs.readFileSync(`${cfg.ownDataDir}/link`).length + " bytes";
});
await probe("open fd 3+ inherited", () => {
  const stat = fs.fstatSync(3);
  return `fd 3 size ${stat.size}`;
});
await probe("child_process.exec", () =>
  require("node:child_process").execSync("echo hi").toString().trim(),
);
await probe("child_process.spawn", () => {
  const child = require("node:child_process").spawn(process.execPath, ["-v"]);
  child.kill();
  return "spawned";
});
await probe("worker_threads", () => {
  const { Worker } = require("node:worker_threads");
  const worker = new Worker("process.exit(0)", { eval: true });
  worker.terminate();
  return "started";
});
await probe("native addon (process.dlopen)", () => {
  process.dlopen({ exports: {} }, cfg.addonPath);
  return "loaded";
});
await probe("node:sqlite open db file", () => {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(cfg.dbFile, { readOnly: true });
  db.close();
  return "opened";
});
await probe("getBuiltinModule node:sqlite", () => {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const db = new DatabaseSync(cfg.dbFile, { readOnly: true });
  const rows = db.prepare("select count(*) as n from sqlite_master").get();
  db.close();
  return `read schema rows ${rows.n}`;
});
await probe("node:sqlite create file outside data dir", () => {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const db = new DatabaseSync(`${cfg.dataDir}/sqlite-made.db`);
  db.exec("create table x(y)");
  db.close();
  return "created";
});
await probe("require('node:sqlite') via createRequire", () => {
  const { DatabaseSync } = require("node:sqlite");
  return typeof DatabaseSync;
});
await probe("process.binding('fs')", () => {
  const binding = process.binding("fs");
  return Object.keys(binding).length + " keys";
});
await probe("internalBinding via --expose-internals", () => {
  if (typeof internalBinding === "undefined") throw new Error("not exposed");
  return "exposed";
});
await probe("process._debugProcess(core pid)", async () => {
  process._debugProcess(cfg.corePid);
  await new Promise((r) => setTimeout(r, 500));
  // Did core actually open its inspector?
  return await withTimeout(
    new Promise((resolve, reject) => {
      const socket = net.connect(9229, "127.0.0.1", () => {
        socket.destroy();
        resolve("core inspector reachable on 9229");
      });
      socket.on("error", () => reject(new Error("signal sent, no inspector")));
    }),
  );
});
await probe("inspector.open", () => {
  require("node:inspector").open(0);
  return "opened";
});
await probe("process.env secrets", () => {
  const leaked = Object.keys(process.env).filter((k) =>
    /SECRET|KEY|TOKEN|PASSWORD|DATABASE/i.test(k),
  );
  if (leaked.length) return leaked.join(",");
  throw new Error("none present");
});
await probe(
  "/proc/<core pid>/environ",
  () => fs.readFileSync(`/proc/${cfg.corePid}/environ`).length + " bytes",
);
await probe("/proc/self/mem", () => {
  fs.openSync("/proc/self/mem", "r");
  return "opened";
});
await probe("tcp connect to core port", () =>
  withTimeout(
    new Promise((resolve, reject) => {
      const socket = net.connect(cfg.corePort, "127.0.0.1", () => {
        socket.destroy();
        resolve("connected");
      });
      socket.on("error", reject);
    }),
  ),
);
await probe("tcp connect to internet", () =>
  withTimeout(
    new Promise((resolve, reject) => {
      const socket = net.connect(443, cfg.internetIp, () => {
        socket.destroy();
        resolve("connected");
      });
      socket.on("error", reject);
    }),
  ),
);
await probe("fetch()", () =>
  withTimeout(
    fetch(`https://${cfg.internetHost}/`).then((r) => `status ${r.status}`),
  ),
);
await probe("tcp listen", () =>
  withTimeout(
    new Promise((resolve, reject) => {
      const server = net.createServer();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        server.close();
        resolve(`listened on ${port}`);
      });
    }),
  ),
);
await probe("udp send", () =>
  withTimeout(
    new Promise((resolve, reject) => {
      const socket = dgram.createSocket("udp4");
      socket.on("error", reject);
      socket.send("x", 53, cfg.internetIp, (error) => {
        socket.close();
        if (error) reject(error);
        else resolve("sent");
      });
    }),
  ),
);
await probe("dns lookup", () =>
  withTimeout(dns.lookup(cfg.internetHost).then((r) => r.address)),
);
await probe("unix/pipe socket to core", () =>
  withTimeout(
    new Promise((resolve, reject) => {
      if (!cfg.pipePath) return reject(new Error("no pipe"));
      const socket = net.connect(cfg.pipePath, () => {
        socket.destroy();
        resolve("connected");
      });
      socket.on("error", reject);
    }),
  ),
);
await probe("import a core module by path", async () => {
  const mod = await import(cfg.coreModuleUrl);
  return Object.keys(mod).join(",");
});
await probe("process.kill(core pid, 0)", () => {
  process.kill(cfg.corePid, 0);
  return "signal allowed";
});

process.stdout.write(`${JSON.stringify(results)}\n`);
process.exit(0);
