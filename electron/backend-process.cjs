// Starting and stopping the embedded backend so nothing it started outlives
// the app. The backend runs as an Electron utility process, which is not a
// process group leader, so on macOS and Linux its descendants are found from
// ps and killed leaves first. Windows uses taskkill /T.

const { spawnSync } = require("child_process");

const BACKEND_STOP_TIMEOUT_MS = 5000;

/** Every process below pid, deepest first, read from `ps`. */
function listDescendants(pid, deps = {}) {
  const run = deps.spawnSync ?? spawnSync;
  if (!Number.isInteger(pid) || pid <= 0) return [];
  const result = run("ps", ["-A", "-o", "pid=,ppid="], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (result?.status !== 0 || typeof result.stdout !== "string") return [];
  const children = new Map();
  for (const line of result.stdout.split(/\r?\n/)) {
    const [child, parent] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(child) || !Number.isInteger(parent)) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  }
  const out = [];
  const walk = (id, seen) => {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      walk(child, seen);
      out.push(child);
    }
  };
  walk(pid, new Set([pid]));
  return out;
}

/**
 * Makes an Electron utility process look like a forked child to the code
 * below: send, exitCode and the exit event.
 */
function wrapUtilityProcess(proc) {
  const wrapper = {
    get pid() {
      return proc.pid;
    },
    exitCode: null,
    signalCode: null,
    get killed() {
      return wrapper.exitCode !== null;
    },
    stdout: proc.stdout,
    stderr: proc.stderr,
    send: (message) => proc.postMessage(message),
    kill: () => proc.kill(),
    on: (event, listener) => {
      proc.on(event, listener);
      return wrapper;
    },
    once: (event, listener) => {
      proc.once(event, listener);
      return wrapper;
    },
  };
  proc.once("exit", (code) => {
    wrapper.exitCode = typeof code === "number" ? code : 1;
  });
  return wrapper;
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

  if (!deps.groupOnly) {
    for (const child of listDescendants(pid, { spawnSync: run })) {
      try {
        kill(child, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
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
  // Taken before the backend exits: once it is gone its children belong to
  // init and can no longer be found from its pid.
  const tree =
    platform === "win32" ? [] : (deps.listDescendants ?? listDescendants)(pid);
  const kill = deps.kill ?? process.kill.bind(process);

  return new Promise((resolve) => {
    let done = false;
    let killed = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Anything the backend left behind goes with it.
      if (platform !== "win32") {
        killTree(pid, { groupOnly: true });
        for (const leftover of tree) {
          if (!isAlive(leftover, kill)) continue;
          try {
            kill(leftover, "SIGKILL");
          } catch {
            // Already gone.
          }
        }
      }
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
  killProcessTree,
  listDescendants,
  wrapUtilityProcess,
  isAlive,
  stopBackendProcess,
};
