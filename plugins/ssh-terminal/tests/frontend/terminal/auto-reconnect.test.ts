// @vitest-environment node
import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = fs.readFileSync(
  new URL("../../../src/frontend/terminal/Terminal.tsx", import.meta.url),
  "utf8",
);
const attempt = source.slice(
  source.indexOf("    function attemptReconnection()"),
  source.indexOf("    // A persisted session that timed out"),
);

function run(keepScrollback: boolean, attempts = 0) {
  const timers: Array<() => void> = [];
  const context = {
    terminal: { cols: 100, rows: 30, clear: vi.fn() },
    hostConfig: { id: 1 },
    isUnmountingRef: { current: false },
    shouldNotReconnectRef: { current: false },
    isReconnectingRef: { current: false },
    isConnectingRef: { current: false },
    isAttachingSessionRef: { current: false },
    wasDisconnectedBySSH: { current: false },
    reconnectTimeoutRef: { current: null as unknown },
    reconnectAttempts: { current: attempts },
    keepScrollbackRef: { current: keepScrollback },
    maxReconnectAttempts: 8,
    setIsConnecting: vi.fn(),
    setShowDisconnectedOverlay: vi.fn(),
    addLog: vi.fn(),
    t: (key: string) => key,
    connectToHost: vi.fn(),
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      return 1;
    },
    Math,
  };
  vm.runInNewContext(`${attempt}\nattemptReconnection();`, context);
  timers.forEach((fn) => fn());
  return context;
}

describe("terminal auto reconnect", () => {
  it("keeps the scrollback while reconnecting after a drop", () => {
    const context = run(true);
    expect(context.terminal.clear).not.toHaveBeenCalled();
    expect(context.connectToHost).toHaveBeenCalledWith(100, 30);
  });

  it("still clears the screen on an ordinary reconnect", () => {
    const context = run(false);
    expect(context.terminal.clear).toHaveBeenCalled();
  });

  it("gives up after the last attempt and stops keeping scrollback", () => {
    const context = run(true, 8);
    expect(context.connectToHost).not.toHaveBeenCalled();
    expect(context.setShowDisconnectedOverlay).toHaveBeenCalledWith(true);
    expect(context.keepScrollbackRef.current).toBe(false);
  });
});
