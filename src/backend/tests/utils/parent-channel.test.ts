import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasParentChannel,
  onParentMessage,
  sendToParent,
  setParentTarget,
} from "../../utils/parent-channel.js";

afterEach(() => setParentTarget(null));

function processLike(extra: Record<string, unknown> = {}) {
  return Object.assign(new EventEmitter(), extra) as never;
}

describe("parent channel", () => {
  it("uses the utility process port when there is one", () => {
    const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
    const send = vi.fn();
    setParentTarget(processLike({ parentPort: port, send }));
    expect(hasParentChannel()).toBe(true);
    expect(sendToParent({ type: "backend-ready" })).toBe(true);
    expect(port.postMessage).toHaveBeenCalledWith({ type: "backend-ready" });
    expect(send).not.toHaveBeenCalled();

    const seen: unknown[] = [];
    const stop = onParentMessage((msg) => seen.push(msg));
    port.emit("message", { data: { type: "shutdown" } });
    stop();
    port.emit("message", { data: { type: "late" } });
    expect(seen).toEqual([{ type: "shutdown" }]);
  });

  it("falls back to the fork channel", () => {
    const send = vi.fn();
    const target = processLike({ send });
    setParentTarget(target);
    expect(sendToParent({ a: 1 })).toBe(true);
    expect(send).toHaveBeenCalledWith({ a: 1 });
    const seen: unknown[] = [];
    onParentMessage((msg) => seen.push(msg));
    (target as unknown as EventEmitter).emit("message", { b: 2 });
    expect(seen).toEqual([{ b: 2 }]);
  });

  it("does nothing without a parent", () => {
    setParentTarget(processLike());
    expect(hasParentChannel()).toBe(false);
    expect(sendToParent({})).toBe(false);
  });
});
