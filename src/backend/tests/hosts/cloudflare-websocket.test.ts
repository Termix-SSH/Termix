import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForWebSocketOpen } from "../../hosts/cloudflare-websocket.js";

function setupSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    terminate: ReturnType<typeof vi.fn>;
  };
  socket.terminate = vi.fn();
  return socket;
}

describe("waitForWebSocketOpen", () => {
  afterEach(() => vi.useRealTimers());

  it("clears listeners and leaves an opened socket alive", async () => {
    vi.useFakeTimers();
    const socket = setupSocket();
    const result = waitForWebSocketOpen(socket, 30_000);

    socket.emit("open");

    await expect(result).resolves.toBeUndefined();
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(socket.listenerCount("open")).toBe(0);
    expect(socket.listenerCount("error")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("terminates a socket that does not open before the deadline", async () => {
    vi.useFakeTimers();
    const socket = setupSocket();
    const result = waitForWebSocketOpen(socket, 30_000);
    const rejection = expect(result).rejects.toThrow(
      "Cloudflare tunnel timeout",
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(socket.listenerCount("open")).toBe(0);
    expect(socket.listenerCount("error")).toBe(0);
  });
});
