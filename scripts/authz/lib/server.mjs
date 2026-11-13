// Starts the built backend on a throwaway data dir and a free port.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export function createWorkspace() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-authz-"));
  fs.mkdirSync(path.join(workDir, "data"));
  return {
    workDir,
    cleanup: () => fs.rmSync(workDir, { recursive: true, force: true }),
  };
}

/**
 * The version core will ship as. A dev-X.Y.Z branch still carries the last
 * release in package.json, so a plugin that needs the coming release would be
 * skipped; the branch name says which release it is.
 */
export function coreVersionOf(coreDir, run = spawnSync) {
  if (process.env.TERMIX_AUTHZ_CORE_VERSION) {
    return process.env.TERMIX_AUTHZ_CORE_VERSION;
  }
  const branch = run("git", ["-C", coreDir, "branch", "--show-current"], {
    encoding: "utf8",
  });
  const match = /^dev-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(
    String(branch?.stdout ?? "").trim(),
  );
  return match ? match[1] : undefined;
}

/** Starts core on workDir/data. Call again on the same workDir to restart. */
export async function startServer({
  coreDir,
  pluginsDir,
  workDir,
  log,
  env = {},
}) {
  const starter = path.join(coreDir, "dist/backend/backend/starter.js");
  if (!fs.existsSync(starter)) {
    throw new Error(
      `No backend build at ${starter}. Run npm run build:backend first.`,
    );
  }
  const inventoryFile = path.join(workDir, "inventory.json");
  fs.rmSync(inventoryFile, { force: true });
  const port = await freePort();
  const version = coreVersionOf(coreDir);
  const logFile = path.join(workDir, "server.log");
  const out = fs.openSync(logFile, "a");

  const child = spawn(process.execPath, [starter], {
    cwd: workDir,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      NODE_ENV: "production",
      DATA_DIR: path.join(workDir, "data"),
      EMBEDDED_BACKEND_PORT: String(port),
      TERMIX_BUNDLED_PLUGINS_DIR: pluginsDir,
      TERMIX_ROUTE_INVENTORY_FILE: inventoryFile,
      TERMIX_AUTHZ_NO_RATE_LIMITS: "1",
      ...(version ? { VERSION: version } : {}),
      // Set when measuring coverage across the unit tests and this run.
      ...(process.env.NODE_V8_COVERAGE
        ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }
        : {}),
      ...env,
    },
    stdio: ["ignore", out, out, "ipc"],
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));

  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      // IPC shutdown saves the database first; a signal on Windows does not.
      child.send({ type: "shutdown" });
      const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
      await exited;
      clearTimeout(timer);
    }
    try {
      fs.closeSync(out);
    } catch {
      // Already closed.
    }
  };

  // Ready once the plugin inventory is written, the last boot step.
  const started = Date.now();
  while (!fs.existsSync(inventoryFile)) {
    if (child.exitCode !== null) {
      throw new Error(
        `Backend exited early (code ${child.exitCode}). Log: ${logFile}`,
      );
    }
    if (Date.now() - started > 300_000) {
      await stop();
      throw new Error(`Backend did not start in 5 minutes. Log: ${logFile}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // Written synchronously, but give the file system a moment on Windows.
  await new Promise((resolve) => setTimeout(resolve, 200));
  const base = `http://127.0.0.1:${port}`;
  log?.(
    `backend up on ${base} in ${Math.round((Date.now() - started) / 1000)}s`,
  );

  return {
    base,
    port,
    logFile,
    inventory: () => JSON.parse(fs.readFileSync(inventoryFile, "utf8")),
    stop,
  };
}
