import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockCtx,
  type MockPluginContext,
} from "@termix/plugin-sdk/testing";
import type { PluginWebSocketConnection } from "@termix/plugin-sdk/backend";
import { createSerialSession } from "../../src/backend/session.js";

// vi.mock's factory is hoisted above every import, including node:events, so
// FakeSerialPort gets its own minimal emitter rather than extending it.
const { listMock, openMock, FakeSerialPort } = vi.hoisted(() => {
  const listMock = vi.fn(async () => [{ path: "/dev/ttyUSB0" }]);
  const openMock = vi.fn();

  class FakeSerialPort {
    isOpen = false;
    private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    constructor(public options: Record<string, unknown>) {}
    on(event: string, listener: (...args: unknown[]) => void) {
      const set = this.listeners.get(event) ?? new Set();
      set.add(listener);
      this.listeners.set(event, set);
      return this;
    }
    private emit(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
    open(cb: (err?: Error) => void) {
      openMock(this.options);
      this.isOpen = true;
      cb();
    }
    write(_data: Buffer, cb: (err?: Error) => void) {
      cb();
    }
    close() {
      this.isOpen = false;
      this.emit("close");
    }
    static list = listMock;
  }

  return { listMock, openMock, FakeSerialPort };
});

vi.mock("serialport", () => ({ SerialPort: FakeSerialPort }));

class FakeSocket extends EventEmitter {
  readyState = 1;
  OPEN = 1;
  sent: unknown[] = [];
  send(msg: string) {
    this.sent.push(JSON.parse(msg));
  }
  close(_code?: number, _reason?: string) {
    this.readyState = 3;
  }
}

function fakeConnection(
  socket: FakeSocket,
  isDataUnlocked: () => boolean = () => true,
): PluginWebSocketConnection {
  return {
    userId: "user-1",
    request: {},
    socket,
    isDataUnlocked,
  } as unknown as PluginWebSocketConnection;
}

async function deliver(socket: FakeSocket, message: object) {
  socket.emit("message", Buffer.from(JSON.stringify(message)));
  // Let the async message handler's microtasks settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("serial session", () => {
  let mock: MockPluginContext;

  beforeEach(() => {
    listMock.mockClear();
    openMock.mockClear();
  });

  it("refuses list_ports and connect without device:serial", async () => {
    mock = createMockCtx({ pluginId: "serial", capabilities: [] });
    const socket = new FakeSocket();
    await createSerialSession(mock.ctx)(fakeConnection(socket));

    await deliver(socket, { type: "list_ports" });
    expect(listMock).not.toHaveBeenCalled();
    expect(socket.sent).toEqual([expect.objectContaining({ type: "error" })]);

    socket.sent.length = 0;
    await deliver(socket, {
      type: "connect",
      data: { path: "/dev/ttyUSB0", baudRate: 9600 },
    });
    expect(openMock).not.toHaveBeenCalled();
    expect(socket.sent).toEqual([expect.objectContaining({ type: "error" })]);
  });

  it("lists ports once granted device:serial", async () => {
    mock = createMockCtx({
      pluginId: "serial",
      capabilities: ["network:serve", "device:serial"],
    });
    const socket = new FakeSocket();
    await createSerialSession(mock.ctx)(fakeConnection(socket));

    await deliver(socket, { type: "list_ports" });

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(socket.sent).toEqual([
      { type: "ports_list", data: [{ path: "/dev/ttyUSB0" }] },
    ]);
  });

  it("opens, writes to and closes a port through connect/input/disconnect", async () => {
    mock = createMockCtx({
      pluginId: "serial",
      capabilities: ["network:serve", "device:serial"],
    });
    const socket = new FakeSocket();
    await createSerialSession(mock.ctx)(fakeConnection(socket));

    await deliver(socket, {
      type: "connect",
      data: { path: "/dev/ttyUSB0", baudRate: 115200 },
    });
    expect(openMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/dev/ttyUSB0", baudRate: 115200 }),
    );
    expect(socket.sent).toContainEqual({ type: "connected" });

    socket.sent.length = 0;
    await deliver(socket, { type: "input", data: "AT\r\n" });
    // write() succeeds silently; nothing is echoed back until the port emits data.

    socket.sent.length = 0;
    await deliver(socket, { type: "disconnect" });
    expect(socket.sent).toContainEqual({ type: "disconnected" });
  });

  it("rejects a connect with no path or baud rate without touching the port", async () => {
    mock = createMockCtx({
      pluginId: "serial",
      capabilities: ["network:serve", "device:serial"],
    });
    const socket = new FakeSocket();
    await createSerialSession(mock.ctx)(fakeConnection(socket));

    await deliver(socket, { type: "connect", data: { path: "" } });

    expect(openMock).not.toHaveBeenCalled();
    expect(socket.sent).toEqual([expect.objectContaining({ type: "error" })]);
  });

  it("closes the socket at connect time when data is locked", async () => {
    mock = createMockCtx({
      pluginId: "serial",
      capabilities: ["network:serve", "device:serial"],
    });
    const socket = new FakeSocket();
    await createSerialSession(mock.ctx)(fakeConnection(socket, () => false));

    expect(socket.sent).toEqual([expect.objectContaining({ type: "error" })]);
  });

  it("refuses a message once data locks mid-session", async () => {
    mock = createMockCtx({
      pluginId: "serial",
      capabilities: ["network:serve", "device:serial"],
    });
    const socket = new FakeSocket();
    let unlocked = true;
    await createSerialSession(mock.ctx)(fakeConnection(socket, () => unlocked));

    unlocked = false;
    await deliver(socket, { type: "list_ports" });

    expect(listMock).not.toHaveBeenCalled();
    expect(socket.sent).toEqual([expect.objectContaining({ type: "error" })]);
  });
});
