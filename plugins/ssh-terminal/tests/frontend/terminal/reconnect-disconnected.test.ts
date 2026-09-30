// @vitest-environment node
import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = fs.readFileSync(
  new URL("../../../src/frontend/terminal/Terminal.tsx", import.meta.url),
  "utf8",
);
const reconnect = source.slice(
  source.indexOf("    function reconnectTerminal()"),
  source.indexOf("    useImperativeHandle("),
);
const methods = source.slice(
  source.indexOf("        reconnect: reconnectTerminal,"),
  source.indexOf("        isConnected: () => isConnected,"),
);

function createHandle(overrides: Record<string, unknown> = {}) {
  const context = {
    terminal: { cols: 80, rows: 24, clear: vi.fn() },
    isConnected: false,
    isUnmountingRef: { current: false },
    shouldNotReconnectRef: { current: true },
    isReconnectingRef: { current: false },
    isConnectingRef: { current: false },
    reconnectTimeoutRef: { current: null },
    reconnectAttempts: { current: 8 },
    wasDisconnectedBySSH: { current: true },
    wasConnectedRef: { current: false },
    updateConnectionError: vi.fn(),
    setShowDisconnectedOverlay: vi.fn(),
    connectToHost: vi.fn(() => {
      context.isConnectingRef.current = true;
    }),
    ...overrides,
  };
  const handle = vm.runInNewContext(
    reconnect + `\n({${methods}})`,
    context,
  ) as { reconnectIfDisconnected: () => boolean; reconnect: () => void };
  return { handle, context };
}

describe("terminal bulk reconnect handle", () => {
  it("uses the manual reconnect flow after a dropped SSH session and rejects duplicate requests", () => {
    const { handle, context } = createHandle();
    expect(handle.reconnectIfDisconnected()).toBe(true);
    expect(context.connectToHost).toHaveBeenCalledWith(80, 24);
    expect(context.shouldNotReconnectRef.current).toBe(false);
    expect(context.reconnectAttempts.current).toBe(0);
    expect(context.wasDisconnectedBySSH.current).toBe(false);
    expect(handle.reconnectIfDisconnected()).toBe(false);
    expect(context.connectToHost).toHaveBeenCalledOnce();
  });
  it.each([
    { isConnected: true },
    { isConnectingRef: { current: true } },
    { isReconnectingRef: { current: true } },
    { reconnectTimeoutRef: { current: 1 } },
    { isUnmountingRef: { current: true } },
    { terminal: null },
  ])(
    "does not interrupt a connected, busy or unavailable terminal: %j",
    (overrides) => {
      const { handle, context } = createHandle(overrides);
      expect(handle.reconnectIfDisconnected()).toBe(false);
      expect(context.connectToHost).not.toHaveBeenCalled();
      expect(context.shouldNotReconnectRef.current).toBe(true);
    },
  );
});
