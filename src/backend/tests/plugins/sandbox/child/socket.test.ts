import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createChildSocket } from "../../../../plugins/sandbox/child/socket.js";
import type { StreamPort } from "../../../../plugins/sandbox/rpc.js";

function fakePort() {
  const port = new EventEmitter() as EventEmitter & Record<string, unknown>;
  port.written = [] as unknown[];
  port.write = (chunk: unknown) => (port.written as unknown[]).push(chunk);
  port.end = vi.fn();
  port.pause = vi.fn();
  port.resume = vi.fn();
  return port;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const asPort = (port: unknown) => port as StreamPort;

describe("plugin process socket", () => {
  it("holds messages until the handler listens", async () => {
    const port = fakePort();
    const socket = createChildSocket(asPort(port), (fn) => fn());
    port.emit("data", { d: '{"type":"connect"}', b: false });
    port.emit("data", { d: '{"type":"ping"}', b: false });

    // The handler awaited something first, then listens.
    await tick();
    const got: string[] = [];
    socket.on("message", (data: Buffer) => got.push(data.toString()));
    await tick();
    expect(got).toEqual(['{"type":"connect"}', '{"type":"ping"}']);

    port.emit("data", { d: "later", b: false });
    expect(got.at(-1)).toBe("later");
  });

  it("keeps order when a message arrives while held ones wait", async () => {
    const port = fakePort();
    const socket = createChildSocket(asPort(port), (fn) => fn());
    port.emit("data", { d: "one", b: false });
    const got: string[] = [];
    socket.on("message", (data: Buffer) => got.push(data.toString()));
    port.emit("data", { d: "two", b: false });
    await tick();
    expect(got).toEqual(["one", "two"]);
  });

  it("gives a close that came early after the held messages", async () => {
    const port = fakePort();
    const socket = createChildSocket(asPort(port), (fn) => fn());
    port.emit("data", { d: "hello", b: false });
    port.emit("remote-end", { code: 1000, reason: "bye" });
    const events: string[] = [];
    socket.on("message", (data: Buffer) => events.push(data.toString()));
    socket.on("close", (code: number) => events.push(`close ${code}`));
    await tick();
    await tick();
    expect(events).toEqual(["hello", "close 1000"]);
    expect(socket.readyState).toBe(3);
  });

  it("pauses the port when a silent handler lets too much pile up", () => {
    const port = fakePort();
    createChildSocket(asPort(port), (fn) => fn());
    port.emit("data", { d: Buffer.alloc(1024 * 1024 + 1), b: true });
    expect(port.pause).toHaveBeenCalled();
  });

  it("sends only while open", () => {
    const port = fakePort();
    const socket = createChildSocket(asPort(port), (fn) => fn());
    (socket.send as (d: string) => void)("a");
    (socket.close as (c: number, r: string) => void)(1008, "no");
    (socket.send as (d: string) => void)("b");
    expect(port.written).toEqual([{ d: "a", b: false }]);
    expect(port.endMeta).toEqual({ code: 1008, reason: "no" });
  });
});
