/**
 * Process shutdown for the backend: one sequence with a total time limit, and
 * every child process the server started ended with it, so a stuck step can
 * never keep the process or its ports alive.
 */

import { spawnSync, type ChildProcess } from "node:child_process";

export interface ShutdownStep {
  name: string;
  run: () => Promise<void> | void;
  /** Most this step may take, so later steps still get their turn. */
  maxMs?: number;
}

interface ShutdownDeps {
  exit: (code: number) => void;
  log?: (message: string) => void;
  /** Total time for every step together. */
  totalMs: number;
  /** Hard exit when the process is still here this long after the start. */
  hardExitMs?: number;
}

const children = new Set<ChildProcess>();

/** Ends the child, and the processes it started, when the backend shuts down. */
export function trackChildProcess(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  children.add(child);
  const forget = () => children.delete(child);
  child.once("exit", forget);
  child.once("error", forget);
}

export function trackedChildCount(): number {
  return children.size;
}

interface KillDeps {
  platform?: NodeJS.Platform;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  spawnSync?: typeof spawnSync;
}

/** taskkill /T on Windows, the child itself elsewhere. */
export function killChildTree(child: ChildProcess, deps: KillDeps = {}): void {
  const pid = child.pid;
  if (!pid || child.exitCode !== null || child.signalCode !== null) return;
  const platform = deps.platform ?? process.platform;
  if (platform === "win32") {
    (deps.spawnSync ?? spawnSync)(
      "taskkill",
      ["/pid", String(pid), "/T", "/F"],
      { windowsHide: true, stdio: "ignore", timeout: 3000 },
    );
    return;
  }
  try {
    (deps.kill ?? process.kill.bind(process))(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

export function killTrackedChildren(deps: KillDeps = {}): number {
  let count = 0;
  for (const child of [...children]) {
    killChildTree(child, deps);
    children.delete(child);
    count++;
  }
  return count;
}

/** Resolves true when the task finished in time, false when it did not. */
export function withDeadline(
  task: Promise<unknown>,
  ms: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => resolve(false), ms);
    task.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(true);
      },
    );
  });
}

/**
 * Runs the steps in order within totalMs, ends every tracked child and exits.
 * Calling it again while it runs returns the same promise.
 */
export function createShutdown(
  steps: () => ShutdownStep[],
  deps: ShutdownDeps,
): (reason: string) => Promise<void> {
  let running: Promise<void> | null = null;
  const log = deps.log ?? (() => {});

  return (reason: string) => {
    if (running) return running;
    log(`Shutting down (${reason})`);

    const hardExitMs = deps.hardExitMs ?? deps.totalMs + 1000;
    const hardExit = setTimeout(() => {
      log(`Shutdown still running after ${hardExitMs} ms, exiting now`);
      killTrackedChildren();
      deps.exit(1);
    }, hardExitMs);
    hardExit.unref?.();

    running = (async () => {
      const deadline = Date.now() + deps.totalMs;
      // A timer can fire a moment before Date.now() reaches the deadline, so
      // a step that used up the whole budget marks it spent.
      let spent = false;
      for (const step of steps()) {
        const total = deadline - Date.now();
        const own = step.maxMs ?? Infinity;
        const left = Math.min(total, own);
        if (spent || left <= 0) {
          log(`Shutdown step "${step.name}" skipped, no time left`);
          continue;
        }
        const finished = await withDeadline(
          Promise.resolve().then(step.run),
          left,
        );
        if (!finished) {
          log(`Shutdown step "${step.name}" ran out of time`);
          if (total <= own) spent = true;
        }
      }
      const killed = killTrackedChildren();
      if (killed > 0) log(`Ended ${killed} child process(es)`);
      clearTimeout(hardExit);
      deps.exit(0);
    })();
    return running;
  };
}

/**
 * A backend started by the desktop app goes when the app does, even when the
 * app died without asking.
 */
export function exitWithParent(
  shutdown: (reason: string) => Promise<void>,
  deps: {
    process?: Pick<NodeJS.Process, "on" | "connected">;
    exit: (code: number) => void;
    hardExitMs?: number;
  },
): void {
  const target = deps.process ?? process;
  target.on("disconnect", () => {
    const timer = setTimeout(() => deps.exit(1), deps.hardExitMs ?? 5000);
    timer.unref?.();
    void shutdown("parent disconnected");
  });
}
