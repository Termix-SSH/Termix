import { describe, expect, it } from "vitest";
import { FramePort } from "@/plugin-frame/rpc";
import { isFrameMessage, type FrameMessage } from "@/plugin-frame/protocol";

/** Two ports wired together the way a shell and a frame are. */
function pair(
  onShellCall: (method: string, args: unknown[]) => unknown = () => undefined,
) {
  const events: Array<[string, unknown]> = [];
  // A real postMessage clones; so does this.
  const send = (target: () => FramePort) => (message: FrameMessage) =>
    queueMicrotask(() => target().receive(structuredClone(message)));
  const shell: FramePort = new FramePort({
    post: send(() => frame),
    onCall: onShellCall,
    onEvent: (name, data) => events.push([name, data]),
    fnPrefix: "s",
  });
  const frame: FramePort = new FramePort({
    post: send(() => shell),
    onCall: () => {
      throw new Error("Unknown call");
    },
    fnPrefix: "p",
  });
  return { shell, frame, events };
}

describe("FramePort", () => {
  it("answers calls and passes errors back as text", async () => {
    const { frame } = pair((method, args) => {
      if (method === "boom") throw new Error("nope");
      return { method, args };
    });
    await expect(frame.call("echo", [1, "a"])).resolves.toEqual({
      method: "echo",
      args: [1, "a"],
    });
    await expect(frame.call("boom")).rejects.toThrow("nope");
  });

  it("passes functions both ways as callable references", async () => {
    let saved: ((value: number) => Promise<unknown>) | null = null;
    const { frame } = pair((method, args) => {
      if (method === "keep") saved = args[0] as never;
      if (method === "useShellFn") return { double: (n: number) => n * 2 };
      return undefined;
    });
    await frame.call("keep", [(value: number) => value + 1]);
    await expect(saved!(41)).resolves.toBe(42);

    const result = (await frame.call("useShellFn")) as {
      double: (n: number) => Promise<number>;
    };
    await expect(result.double(21)).resolves.toBe(42);
  });

  it("delivers events with their data decoded", async () => {
    const { frame, events } = pair();
    frame.emit("value", { key: "rail:x:badge", value: 3 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([["value", { key: "rail:x:badge", value: 3 }]]);
  });

  it("refuses an unknown function id", async () => {
    const { frame } = pair();
    await expect(frame.call("fn", ["s999"])).rejects.toThrow(
      "Unknown function",
    );
  });

  it("fails pending calls when closed", async () => {
    const lonely = new FramePort({
      post: () => {},
      onCall: () => undefined,
      fnPrefix: "p",
    });
    const pending = lonely.call("never");
    lonely.close();
    await expect(pending).rejects.toThrow("Frame closed");
    await expect(lonely.call("again")).rejects.toThrow("Frame closed");
  });
});

describe("isFrameMessage", () => {
  it("checks the shape of every message", () => {
    expect(
      isFrameMessage({ ch: "termix-frame", t: "hello", role: "view" }),
    ).toBe(true);
    expect(
      isFrameMessage({ ch: "termix-frame", t: "hello", role: "admin" }),
    ).toBe(false);
    expect(
      isFrameMessage({
        ch: "termix-frame",
        t: "call",
        id: 1.5,
        method: "x",
        args: [],
      }),
    ).toBe(false);
    expect(
      isFrameMessage({
        ch: "termix-frame",
        t: "call",
        id: 1,
        method: "x",
        args: "a",
      }),
    ).toBe(false);
    expect(isFrameMessage({ ch: "other", t: "event", name: "x" })).toBe(false);
    expect(isFrameMessage("hello")).toBe(false);
    expect(isFrameMessage(null)).toBe(false);
  });
});
