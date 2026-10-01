/// <reference types="vite/client" />
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import sourceText from "../../../src/frontend/terminal/Terminal.tsx?raw";

const source = ts.createSourceFile(
  "Terminal.tsx",
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const names = [
  "setupWebSocketListeners",
  "applySharedSize",
  "fitTerminal",
  "scheduleNotify",
];
const functions: string[] = [];
function visit(node: ts.Node) {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name &&
    names.includes(node.name.text)
  )
    functions.push(node.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
if (functions.length !== names.length)
  throw new Error("Missing terminal size handlers");
const create = new Function(
  "state",
  ts.transpileModule(
    `
  const { terminal, hostConfig, sharedSizeRef, fitAddonRef, webSocketRef, emitSessionMessage } = state;
  const connectionAttemptIdRef = { current: 1 };
  ${functions.join("\n")}
  setupWebSocketListeners(webSocketRef.current, 80, 24, hostConfig);
  return { fit: fitTerminal, notify: scheduleNotify };
`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText,
) as (state: Record<string, unknown>) => {
  fit: () => void;
  notify: (cols: number, rows: number) => void;
};

function fixture(shared = true) {
  const events = new Map<string, (event: { data: string }) => void>();
  const terminal = {
    cols: 80,
    rows: 24,
    resize: vi.fn((cols: number, rows: number) => {
      terminal.cols = cols;
      terminal.rows = rows;
    }),
  };
  const fit = vi.fn(() => {
    terminal.cols = 80;
    terminal.rows = 24;
  });
  const socket = {
    addEventListener: (name: string, fn: (event: { data: string }) => void) =>
      events.set(name, fn),
    send: vi.fn(),
  };
  const handlers = create({
    terminal,
    hostConfig: shared ? { joinShareId: "share" } : {},
    sharedSizeRef: { current: null },
    fitAddonRef: { current: { fit } },
    webSocketRef: { current: socket },
    emitSessionMessage: vi.fn(),
  });
  const resize = (cols: unknown, rows: unknown) =>
    events.get("message")!({
      data: JSON.stringify({ type: "resized", cols, rows }),
    });
  return { terminal, fit, handlers, socket, resize };
}

describe("in-app shared terminal sizing", () => {
  it("uses presenter sizes and does not refit or resize the remote shell from the viewer", () => {
    const f = fixture();
    f.resize(132, 40);
    expect([f.terminal.cols, f.terminal.rows]).toEqual([132, 40]);
    f.handlers.fit();
    expect(f.fit).not.toHaveBeenCalled();
    expect([f.terminal.cols, f.terminal.rows]).toEqual([132, 40]);
    f.handlers.notify(80, 24);
    expect(f.socket.send).not.toHaveBeenCalled();
    f.resize(100, 30);
    expect([f.terminal.cols, f.terminal.rows]).toEqual([100, 30]);
  });

  it("continues fitting the owner's terminal normally", () => {
    const f = fixture(false);
    f.resize(132, 40);
    expect(f.terminal.resize).not.toHaveBeenCalled();
    f.handlers.fit();
    expect(f.fit).toHaveBeenCalledOnce();
  });

  it.each([0, -1, 1.5, "132"])("rejects an invalid column count %s", (cols) => {
    const f = fixture();
    f.resize(cols, 24);
    expect(f.terminal.resize).not.toHaveBeenCalled();
  });
});
