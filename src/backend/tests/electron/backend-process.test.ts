import { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  killProcessTree,
  listDescendants,
  stopBackendProcess,
  wrapUtilityProcess,
} = require("../../../../electron/backend-process.cjs");

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vi.useRealTimers();
});

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    pid: 4242,
    exitCode: null as number | null,
    signalCode: null as string | null,
    send: vi.fn(),
  });
}

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

describe("listDescendants", () => {
  it("walks the tree from ps, deepest first", () => {
    const run = vi.fn(() => ({
      status: 0,
      stdout: [
        "  1     0",
        " 10     1",
        " 11    10",
        " 12    11",
        " 13    10",
        " 99     1",
        "",
      ].join("\n"),
    }));
    expect(listDescendants(10, { spawnSync: run })).toEqual([12, 11, 13]);
    expect(run).toHaveBeenCalledWith(
      "ps",
      ["-A", "-o", "pid=,ppid="],
      expect.anything(),
    );
  });

  it("gives nothing when ps fails or the pid is not real", () => {
    expect(listDescendants(10, { spawnSync: () => ({ status: 1 }) })).toEqual(
      [],
    );
    expect(listDescendants(0)).toEqual([]);
  });
});

describe("wrapUtilityProcess", () => {
  it("sends through postMessage and records the exit", () => {
    const proc = Object.assign(new EventEmitter(), {
      pid: 7,
      postMessage: vi.fn(),
      kill: vi.fn(),
      stdout: null,
      stderr: null,
    });
    const child = wrapUtilityProcess(proc);
    child.send({ type: "shutdown" });
    expect(proc.postMessage).toHaveBeenCalledWith({ type: "shutdown" });
    expect(child.killed).toBe(false);
    proc.emit("exit", 0);
    expect(child.exitCode).toBe(0);
    expect(child.killed).toBe(true);
  });
});

describe("killProcessTree", () => {
  it("uses taskkill /T on Windows", () => {
    const run = vi.fn(() => ({ status: 0 }));
    expect(killProcessTree(10, { platform: "win32", spawnSync: run })).toBe(
      true,
    );
    expect(run).toHaveBeenCalledWith(
      "taskkill",
      ["/pid", "10", "/T", "/F"],
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it("kills the process group elsewhere", () => {
    const kill = vi.fn();
    killProcessTree(10, { platform: "linux", kill });
    expect(kill).toHaveBeenCalledWith(-10, "SIGKILL");
  });

  it("only touches the group once the leader may be gone", () => {
    const kill = vi.fn((pid: number) => {
      if (pid < 0) throw new Error("ESRCH");
    });
    expect(
      killProcessTree(10, { platform: "linux", kill, groupOnly: true }),
    ).toBe(false);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("ignores pids that are not real", () => {
    const kill = vi.fn();
    expect(killProcessTree(0, { platform: "linux", kill })).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });
});

describe("stopBackendProcess", () => {
  it("asks the backend to shut down and waits for it", async () => {
    const child = fakeChild();
    const killTree = vi.fn();
    child.send.mockImplementation(() => setImmediate(() => child.emit("exit")));
    await expect(
      stopBackendProcess(child, { killTree, platform: "win32" }),
    ).resolves.toBe("exited");
    expect(child.send).toHaveBeenCalledWith({ type: "shutdown" });
    expect(killTree).not.toHaveBeenCalled();
  });

  it("sweeps the process group after a clean exit outside Windows", async () => {
    const child = fakeChild();
    const killTree = vi.fn();
    child.send.mockImplementation(() => setImmediate(() => child.emit("exit")));
    await stopBackendProcess(child, { killTree, platform: "linux" });
    expect(killTree).toHaveBeenCalledWith(4242, { groupOnly: true });
  });

  it("kills the tree when the backend does not exit in time", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const killTree = vi.fn();
    const stopped = stopBackendProcess(child, {
      killTree,
      platform: "win32",
      timeoutMs: 5000,
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(killTree).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(killTree).toHaveBeenCalledWith(4242);
    child.emit("exit");
    await expect(stopped).resolves.toBe("killed");
  });

  it("still resolves when the exit event never comes", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const stopped = stopBackendProcess(child, {
      killTree: vi.fn(),
      platform: "win32",
      timeoutMs: 100,
    });
    await vi.advanceTimersByTimeAsync(1100);
    await expect(stopped).resolves.toBe("killed");
  });

  it("does nothing for a backend that already exited", async () => {
    const child = fakeChild();
    child.exitCode = 0;
    await expect(stopBackendProcess(child)).resolves.toBe("exited");
    expect(child.send).not.toHaveBeenCalled();
  });

  // The real case: a backend that ignores the shutdown message and has a
  // child of its own holding a port. Both must be gone afterwards.
  it("frees the ports of a stuck backend and its children", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-backend-"));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const grandchild = path.join(dir, "grandchild.cjs");
    const backend = path.join(dir, "backend.cjs");
    fs.writeFileSync(
      grandchild,
      `const net = require("net");
       const server = net.createServer().listen(0, "127.0.0.1", () => {
         process.send({ port: server.address().port });
       });`,
    );
    fs.writeFileSync(
      backend,
      `const { fork } = require("child_process");
       process.on("message", () => {});
       const child = fork(${JSON.stringify(grandchild)});
       child.on("message", (msg) => process.send({ ...msg, child: child.pid }));`,
    );

    const child = fork(backend, [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    cleanups.push(() => killProcessTree(child.pid));
    const { port } = await new Promise<{ port: number }>((resolve) =>
      child.once("message", (msg) => resolve(msg as { port: number })),
    );
    expect(await isListening(port)).toBe(true);

    const how = await stopBackendProcess(child, { timeoutMs: 300 });

    expect(how).toBe("killed");
    // taskkill returns before Windows frees the socket.
    await vi.waitFor(async () => expect(await isListening(port)).toBe(false), {
      timeout: 5000,
    });
  }, 20000);
});
