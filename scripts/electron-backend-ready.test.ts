import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getGlobalLogLevel,
  setGlobalLogLevel,
  systemLogger,
} from "../src/backend/utils/logger";

const starter = readFileSync(
  new URL("../src/backend/starter.ts", import.meta.url),
  "utf8",
);
const announceReady = starter.slice(
  starter.indexOf('systemLogger.success("Termix backend started successfully"'),
  starter.indexOf("const gracefulShutdown"),
);

const main = readFileSync(
  new URL("../electron/main.cjs", import.meta.url),
  "utf8",
);
const startBackend = main.slice(
  main.indexOf("function startBackendServer()"),
  main.indexOf("function clearBackendPidFile()"),
);

function start() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    pid: 123,
  });
  const handleBackendRequest = vi.fn();
  const context = {
    reapOrphanedBackendProcess: vi.fn(),
    getBackendPaths: () => ({ entryPath: "/backend.js", backendCwd: "/app" }),
    getBackendDataDir: () => "/data",
    getBackendPidFilePath: () => "/data/backend.pid",
    clearBackendPidFile: vi.fn(),
    classifyBackendFailure: () => ({ reason: "crashed", port: null }),
    logToFile: vi.fn(),
    fs: {
      existsSync: () => true,
      statSync: () => ({ isDirectory: () => true }),
      writeFileSync: vi.fn(),
    },
    fork: () => child,
    app: { isPackaged: true, getVersion: () => "2.9.0" },
    process: { env: { LOG_LEVEL: "error" } },
    isDev: false,
    appRoot: "/app",
    BACKEND_STDERR_TAIL_LIMIT: 4096,
    handleBackendRequest,
    setTimeout,
    clearTimeout,
  };
  const ready = runInNewContext(
    `${startBackend}\nstartBackendServer()`,
    context,
  ) as Promise<boolean>;
  const settled = vi.fn();
  void ready.then(settled);
  return { child, ready, settled, handleBackendRequest };
}

afterEach(() => vi.useRealTimers());

describe("embedded backend readiness", () => {
  it("starts immediately on IPC readiness without any success log", async () => {
    vi.useFakeTimers();
    const { child, settled } = start();
    child.emit("message", { type: "backend-ready" });
    await Promise.resolve();
    expect(settled).toHaveBeenCalledWith(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not mistake another IPC request for readiness", async () => {
    vi.useFakeTimers();
    const { child, settled, handleBackendRequest } = start();
    const request = { type: "backend-request", channel: "sync-proxy-config" };
    child.emit("message", request);
    await Promise.resolve();
    expect(handleBackendRequest).toHaveBeenCalledWith(request);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(settled).toHaveBeenCalledWith(true);
  });

  it("preserves the legacy success log and tolerates duplicate ready signals", async () => {
    vi.useFakeTimers();
    const { child, settled } = start();
    child.stdout.emit(
      "data",
      Buffer.from("Termix backend started successfully"),
    );
    child.emit("message", { type: "backend-ready" });
    await Promise.resolve();
    expect(settled).toHaveBeenCalledExactlyOnceWith(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["exit", "error"])(
    "reports %s before readiness as a failed start",
    async (event) => {
      vi.useFakeTimers();
      const { child, ready } = start();
      child.emit(event, event === "exit" ? 1 : new Error("spawn failed"));
      await expect(ready).resolves.toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

describe("backend readiness announcement", () => {
  it.each(["warn", "error"])(
    "sends readiness even when %s logging hides startup success",
    (level) => {
      const original = getGlobalLogLevel();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const send = vi.fn();
      try {
        setGlobalLogLevel(level);
        runInNewContext(announceReady, {
          systemLogger,
          process: { env: { ELECTRON_EMBEDDED: "true" }, send },
          initStartTime: Date.now(),
        });
        expect(log).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledExactlyOnceWith({ type: "backend-ready" });
      } finally {
        setGlobalLogLevel(original);
        log.mockRestore();
      }
    },
  );

  it("does not require an IPC channel in the standalone backend", () => {
    expect(() =>
      runInNewContext(announceReady, {
        systemLogger: { success: vi.fn() },
        process: { env: {} },
        initStartTime: Date.now(),
      }),
    ).not.toThrow();
  });
});
