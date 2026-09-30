import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import sourceText from "../../../src/frontend/terminal/Terminal.tsx?raw";

const source = ts.createSourceFile(
  "Terminal.tsx",
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let effect: string | undefined;
function visit(node: ts.Node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(source) === "useEffect" &&
    node.arguments[0]?.getText(source).includes("isMountedRef.current = true")
  ) {
    effect = node.arguments[0].getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
if (!effect) throw new Error("Missing terminal lifecycle effect");
const mount = new Function(
  "state",
  ts.transpileModule(
    `
  const { isMountedRef, hostConfig, currentHostIdRef, isUnmountingRef,
    shouldNotReconnectRef, isReconnectingRef, setIsConnecting,
    reconnectTimeoutRef, connectionTimeoutRef, totpTimeoutRef,
    pingIntervalRef, pongTimeoutRef, webSocketRef } = state;
  return (${effect})();
`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText,
) as (state: Record<string, unknown>) => () => void;

afterEach(() => vi.useRealTimers());

describe("terminal unmount", () => {
  it.each([1, 2, null])(
    "closes the socket when current host is %s",
    (currentHost) => {
      vi.useFakeTimers();
      const timeout = () => ({ current: setTimeout(() => {}, 10000) });
      const state = {
        isMountedRef: { current: false },
        hostConfig: { id: 1, instanceId: "collab-present-room" },
        currentHostIdRef: { current: currentHost },
        isUnmountingRef: { current: false },
        shouldNotReconnectRef: { current: false },
        isReconnectingRef: { current: true },
        setIsConnecting: vi.fn(),
        reconnectTimeoutRef: timeout(),
        connectionTimeoutRef: timeout(),
        totpTimeoutRef: timeout(),
        pongTimeoutRef: timeout(),
        pingIntervalRef: { current: setInterval(() => {}, 1000) },
        webSocketRef: { current: { close: vi.fn() } },
      };
      const unmount = mount(state);
      expect(state.isMountedRef.current).toBe(true);
      unmount();
      expect(state.webSocketRef.current.close).toHaveBeenCalledOnce();
      expect(state.shouldNotReconnectRef.current).toBe(true);
      expect(state.isUnmountingRef.current).toBe(true);
      expect(state.isReconnectingRef.current).toBe(false);
      expect(state.isMountedRef.current).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      unmount();
      expect(state.webSocketRef.current.close).toHaveBeenCalledOnce();
    },
  );
});
