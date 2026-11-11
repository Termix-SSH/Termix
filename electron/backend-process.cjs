// Starting and stopping the embedded backend so nothing it started outlives
// the app. On macOS and Linux the backend leads its own process group, so the
// whole group can be killed at once. Windows has no groups, taskkill /T walks
// the tree instead.

const { spawnSync } = require("child_process");

const BACKEND_STOP_TIMEOUT_MS = 5000;

function backendSpawnOptions(platform = process.platform) {
  // detached on Windows opens a console window and does not make a group.
  return platform === "win32" ? {} : { detached: true };
}

function killProcessTree(pid, deps = {}) {
  const platform = deps.platform ?? process.platform;
  const kill = deps.kill ?? process.kill.bind(process);
  const run = deps.spawnSync ?? spawnSync;
  if (!Number.isInteger(pid) || pid <= 0) return false;

  if (platform === "win32") {
    const result = run("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
      timeout: 5000,
    });
    return result?.status === 0;
  }

  try {
    kill(-pid, "SIGKILL");
    return true;
  } catch {
    // Not a group leader. After the leader exited its pid may belong to
    // someone else, so only the group is ever touched then.
    if (deps.groupOnly) return false;
  }
  try {
    kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

function isAlive(pid, kill = process.kill.bind(process)) {
  try {
    kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Asks the backend to shut down and waits for it to exit. Past the timeout
 * the whole tree is killed. Resolves once the backend is gone either way.
 */
function stopBackendProcess(child, deps = {}) {
  const timeoutMs = deps.timeoutMs ?? BACKEND_STOP_TIMEOUT_MS;
  const killTree = deps.killTree ?? killProcessTree;
  const platform = deps.platform ?? process.platform;
  const log = deps.log ?? (() => {});

  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve("exited");
  }
  const pid = child.pid;

  return new Promise((resolve) => {
    let done = false;
    let killed = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Anything the backend left behind in its group goes with it.
      if (platform !== "win32") killTree(pid, { groupOnly: true });
      resolve(killed ? "killed" : "exited");
    };

    const timer = setTimeout(() => {
      log(`Backend did not exit in ${timeoutMs} ms, killing its process tree`);
      killed = true;
      killTree(pid);
      // The exit event can lag the kill a little; do not hang on it.
      setTimeout(finish, 1000);
    }, timeoutMs);

    child.once("exit", finish);

    try {
      child.send({ type: "shutdown" });
    } catch {
      // IPC already closed. The backend exits on disconnect by itself.
    }
  });
}

module.exports = {
  BACKEND_STOP_TIMEOUT_MS,
  backendSpawnOptions,
  killProcessTree,
  isAlive,
  stopBackendProcess,
};
