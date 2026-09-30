import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { createC2SAuthBridge } = require("../../../../electron/c2s-auth.cjs");

function setup() {
  const sender = Object.assign(new EventEmitter(), {
    send: vi.fn(),
    isDestroyed: () => false,
  });
  const ws = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(() => {
      ws.readyState = 3;
      ws.emit("close");
    }),
  });
  let answer!: (
    event: { sender: unknown },
    id: string,
    value: unknown,
  ) => boolean;
  const attach = createC2SAuthBridge(
    {
      handle: (_name: string, fn: typeof answer) => {
        answer = fn;
      },
    },
    () => ({ isDestroyed: () => false, webContents: sender }),
  );
  attach(ws, "dynamic");
  const prompt = () =>
    ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "auth-prompt",
          requestId: "server-challenge",
          request: { kind: "totp", prompt: "Code:", retry: false },
        }),
      ),
      false,
    );
  return { sender, ws, answer, prompt };
}
afterEach(() => vi.useRealTimers());
describe("desktop tunnel prompt bridge", () => {
  it("binds answers to the renderer and challenge, and rejects replay", () => {
    const { sender, ws, answer, prompt } = setup();
    prompt();
    const id = sender.send.mock.calls[0][1].id;
    expect(answer({ sender: {} }, id, "123456")).toBe(false);
    expect(answer({ sender }, "unknown", "123456")).toBe(false);
    expect(answer({ sender }, id, { secret: "bad" })).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
    expect(answer({ sender }, id, "123456")).toBe(true);
    expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({
      type: "auth-response",
      requestId: "server-challenge",
      answer: "123456",
    });
    expect(answer({ sender }, id, "again")).toBe(false);
    expect(sender.listenerCount("destroyed")).toBe(0);
    ws.close();
  });
  it.each(["close", "reload", "timeout"])(
    "clears a pending dialog on %s",
    (reason) => {
      vi.useFakeTimers();
      const { sender, ws, answer, prompt } = setup();
      prompt();
      const id = sender.send.mock.calls[0][1].id;
      if (reason === "close") ws.close();
      else if (reason === "reload") sender.emit("did-start-loading");
      else vi.advanceTimersByTime(60_000);
      expect(sender.send).toHaveBeenLastCalledWith("c2s-auth-prompt", {
        id,
        closed: true,
      });
      expect(answer({ sender }, id, "late")).toBe(false);
      expect(ws.close).toHaveBeenCalled();
    },
  );
});
