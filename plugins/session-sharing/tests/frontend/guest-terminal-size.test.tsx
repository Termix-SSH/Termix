import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuestTerminalView } from "../../src/frontend/SharedSessionView";

const f = vi.hoisted(() => ({
  terminal: {
    cols: 80,
    rows: 24,
    options: {},
    loadAddon: vi.fn(),
    open: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
  },
  fit: vi.fn(),
  onResize: null as (() => void) | null,
}));
vi.mock("@termix/plugin-sdk/frontend", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("react-xtermjs", () => ({
  useXTerm: () => ({ instance: f.terminal, ref: { current: null } }),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {
      f.fit();
    }
  },
}));
vi.mock("../../src/frontend/shared", () => ({
  wsUrlForPath: async () => "ws://termix.test/terminal",
  RemoteDisplay: () => null,
  Loader: () => null,
}));
class Socket {
  static OPEN = 1;
  static latest: Socket;
  readyState = 1;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor() {
    Socket.latest = this;
  }
  send() {}
  close() {}
  message(value: object) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  f.terminal.cols = 80;
  f.terminal.rows = 24;
  f.terminal.resize.mockImplementation((cols: number, rows: number) => {
    f.terminal.cols = cols;
    f.terminal.rows = rows;
  });
  f.fit.mockImplementation(() => {
    f.terminal.cols = 80;
    f.terminal.rows = 24;
  });
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(fn: () => void) {
        f.onResize = fn;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps the presenter's grid while the guest window changes size", async () => {
  render(
    <GuestTerminalView
      share={{ permissionLevel: "read-only" }}
      wsPath="/plugin-ws/ssh-terminal/terminal?shareToken=test"
    />,
  );
  await waitFor(() => expect(Socket.latest.onmessage).toBeTypeOf("function"));
  act(() => Socket.latest.message({ type: "resized", cols: 132, rows: 40 }));
  expect([f.terminal.cols, f.terminal.rows]).toEqual([132, 40]);
  act(() => f.onResize?.());
  expect([f.terminal.cols, f.terminal.rows]).toEqual([132, 40]);
  act(() => Socket.latest.message({ type: "resized", cols: 100, rows: 30 }));
  expect([f.terminal.cols, f.terminal.rows]).toEqual([100, 30]);
});

describe("invalid shared terminal dimensions", () => {
  it.each([0, -1, 1.5, "132"])("ignores cols=%s", async (cols) => {
    render(
      <GuestTerminalView
        share={{ permissionLevel: "read-only" }}
        wsPath="/plugin-ws/ssh-terminal/terminal?shareToken=test"
      />,
    );
    await waitFor(() => expect(Socket.latest.onmessage).toBeTypeOf("function"));
    act(() => Socket.latest.message({ type: "resized", cols, rows: 24 }));
    expect(f.terminal.resize).not.toHaveBeenCalled();
  });
});
