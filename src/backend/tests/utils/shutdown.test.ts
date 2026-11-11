import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createShutdown,
  exitWithParent,
  killChildTree,
  killTrackedChildren,
  trackChildProcess,
  trackedChildCount,
  withDeadline,
} from "../../utils/shutdown.js";

function never(): Promise<void> {
  return new Promise(() => {});
}

function exited(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", () => resolve());
  });
}

afterEach(() => {
  killTrackedChildren();
  vi.useRealTimers();
});

describe("withDeadline", () => {
  it("reports whether the task finished in time", async () => {
    expect(await withDeadline(Promise.resolve(), 100)).toBe(true);
    expect(await withDeadline(Promise.reject(new Error("x")), 100)).toBe(true);
    expect(await withDeadline(never(), 20)).toBe(false);
    expect(await withDeadline(Promise.resolve(), 0)).toBe(false);
  });
});

describe("createShutdown", () => {
  it("runs every step in order and exits 0", async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const shutdown = createShutdown(
      () => [
        { name: "a", run: () => void order.push("a") },
        { name: "b", run: async () => void order.push("b") },
      ],
      { totalMs: 1000, exit },
    );
    await shutdown("test");
    expect(order).toEqual(["a", "b"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("does not let one stuck step hold the process", async () => {
    const exit = vi.fn();
    const later = vi.fn();
    const started = Date.now();
    const shutdown = createShutdown(
      () => [
        { name: "stuck", run: never },
        { name: "later", run: later },
      ],
      { totalMs: 100, exit },
    );
    await shutdown("test");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(exit).toHaveBeenCalledWith(0);
    // The total budget is gone, so the next step is skipped.
    expect(later).not.toHaveBeenCalled();
  });

  it("keeps time for later steps when a step has its own limit", async () => {
    const exit = vi.fn();
    const later = vi.fn();
    const shutdown = createShutdown(
      () => [
        { name: "plugins", run: never, maxMs: 30 },
        { name: "database", run: later },
      ],
      { totalMs: 1000, exit },
    );
    await shutdown("test");
    expect(later).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("runs once when asked twice", async () => {
    const step = vi.fn();
    const exit = vi.fn();
    const shutdown = createShutdown(() => [{ name: "a", run: step }], {
      totalMs: 1000,
      exit,
    });
    await Promise.all([shutdown("one"), shutdown("two")]);
    expect(step).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it("ends tracked child processes before it exits", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    trackChildProcess(child);
    expect(trackedChildCount()).toBe(1);
    const shutdown = createShutdown(() => [{ name: "stuck", run: never }], {
      totalMs: 50,
      exit: vi.fn(),
    });
    await shutdown("test");
    await exited(child);
    expect(trackedChildCount()).toBe(0);
  });
});

describe("child tracking", () => {
  it("forgets a child once it exits", async () => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    trackChildProcess(child);
    await exited(child);
    expect(trackedChildCount()).toBe(0);
  });

  it("kills the tree with taskkill on Windows", () => {
    const run = vi.fn();
    const child = { pid: 42, exitCode: null, signalCode: null };
    killChildTree(child as never, { platform: "win32", spawnSync: run });
    expect(run).toHaveBeenCalledWith(
      "taskkill",
      ["/pid", "42", "/T", "/F"],
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it("kills the child itself elsewhere", () => {
    const kill = vi.fn();
    const child = { pid: 42, exitCode: null, signalCode: null };
    killChildTree(child as never, { platform: "linux", kill });
    expect(kill).toHaveBeenCalledWith(42, "SIGKILL");
  });

  it("leaves a child that already exited alone", () => {
    const kill = vi.fn();
    const child = { pid: 42, exitCode: 0, signalCode: null };
    killChildTree(child as never, { platform: "linux", kill });
    expect(kill).not.toHaveBeenCalled();
  });
});

describe("exitWithParent", () => {
  it("shuts down when the IPC channel closes", () => {
    const parent = Object.assign(new EventEmitter(), { connected: true });
    const shutdown = vi.fn(() => never());
    exitWithParent(shutdown, { process: parent as never, exit: vi.fn() });
    parent.emit("disconnect");
    expect(shutdown).toHaveBeenCalledWith("parent disconnected");
  });

  it("exits on its own when the shutdown hangs", () => {
    vi.useFakeTimers();
    const parent = Object.assign(new EventEmitter(), { connected: true });
    const exit = vi.fn();
    exitWithParent(() => never(), {
      process: parent as never,
      exit,
      hardExitMs: 5000,
    });
    parent.emit("disconnect");
    vi.advanceTimersByTime(4999);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
