import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import type {
  PluginContext,
  PluginSshConnectOptions,
} from "@termix/plugin-sdk/backend";
import { createC2SPrompt } from "../../src/backend/c2s-auth.js";
import { createC2SConnections } from "../../src/backend/c2s-connections.js";

class Socket extends EventEmitter {
  readyState = 1;
  send = vi.fn();
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  get ws() {
    return this as unknown as WebSocket;
  }
  answer(requestId: string, answer: string | null) {
    this.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "auth-response", requestId, answer })),
      false,
    );
  }
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
afterEach(() => vi.useRealTimers());

describe("client tunnel authentication", () => {
  it("accepts only the current challenge on its socket and removes answer listeners", async () => {
    const socket = new Socket();
    const prompt = createC2SPrompt(socket.ws);
    const result = prompt.ask({ kind: "totp", prompt: "Code:", retry: false });
    const sent = JSON.parse(socket.send.mock.calls[0][0]);
    socket.answer("stale", "wrong");
    expect(socket.listenerCount("message")).toBe(1);
    socket.answer(sent.requestId, "123456");
    await expect(result).resolves.toBe("123456");
    expect(socket.listenerCount("message")).toBe(0);
    expect(socket.send).toHaveBeenCalledTimes(1);
    const retry = prompt.ask({ kind: "totp", prompt: "Code:", retry: true });
    socket.answer(sent.requestId, "old");
    socket.close();
    await expect(retry).rejects.toThrow("cancelled");
  });

  it("cancels on a null answer and bounds unanswered prompts", async () => {
    vi.useFakeTimers();
    const cancelled = new Socket();
    const request = createC2SPrompt(cancelled.ws).ask({
      kind: "input",
      prompt: "Password:",
      echo: false,
      isPush: false,
    });
    cancelled.answer(
      JSON.parse(cancelled.send.mock.calls[0][0]).requestId,
      null,
    );
    await expect(request).rejects.toThrow("cancelled");
    expect(cancelled.readyState).toBe(3);
    const socket = new Socket();
    const result = createC2SPrompt(socket.ws).ask({
      kind: "totp",
      prompt: "Code:",
      retry: false,
    });
    const failed = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(60_000);
    await failed;
    expect(socket.readyState).toBe(3);
    expect(socket.listenerCount("message")).toBe(0);
  });

  it("reuses one authenticated source for concurrent streams, scoped to user, host and desktop runtime", async () => {
    let actor = "alice";
    const disposals: Array<() => void> = [];
    const connections: Array<{
      client: EventEmitter;
      dispose: ReturnType<typeof vi.fn>;
    }> = [];
    const connect = vi.fn(
      async (_id: number, options: PluginSshConnectOptions) => {
        expect(options.prompt).toBeDefined();
        const result = {
          client: new EventEmitter(),
          host: {},
          jumpClient: null,
          dispose: vi.fn(),
        };
        connections.push(result);
        return result;
      },
    );
    const acquire = createC2SConnections({
      currentActor: () => actor,
      disposables: { add: (fn: () => void) => disposals.push(fn) },
      ssh: { connect },
    } as unknown as PluginContext);
    const anchor = new Socket();
    const first = new Socket();
    const second = new Socket();
    await Promise.all([
      acquire(anchor.ws, 1, "runtime-a"),
      acquire(first.ws, 1, "runtime-a"),
      acquire(second.ws, 1, "runtime-a"),
    ]);
    expect(connect).toHaveBeenCalledTimes(1);
    first.close();
    second.close();
    await flush();
    expect(connections[0].dispose).not.toHaveBeenCalled();
    await acquire(new Socket().ws, 1, "runtime-b");
    await acquire(new Socket().ws, 2, "runtime-a");
    actor = "bob";
    await acquire(new Socket().ws, 1, "runtime-a");
    expect(connect).toHaveBeenCalledTimes(4);
    anchor.close();
    await flush();
    expect(connections[0].dispose).toHaveBeenCalledOnce();
    disposals.forEach((dispose) => dispose());
    await flush();
    expect(
      connections.every((entry) => entry.dispose.mock.calls.length === 1),
    ).toBe(true);
  });

  it("disposes a connection that authenticates after the desktop stopped", async () => {
    let ready!: (value: unknown) => void;
    const source = { client: new EventEmitter(), dispose: vi.fn() };
    const acquire = createC2SConnections({
      currentActor: () => "alice",
      disposables: { add: vi.fn() },
      ssh: {
        connect: () =>
          new Promise((resolve) => {
            ready = resolve;
          }),
      },
    } as unknown as PluginContext);
    const socket = new Socket();
    const pending = acquire(socket.ws, 1, "stopped");
    socket.close();
    ready(source);
    await expect(pending).rejects.toThrow("closed");
    await flush();
    expect(source.dispose).toHaveBeenCalledOnce();
  });
});
