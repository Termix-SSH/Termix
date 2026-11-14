/**
 * The sandbox RPC endpoint over an in-memory channel: calls, callbacks both
 * ways, errors, and streams whose back pressure reaches the sender.
 */
import { describe, expect, it } from "vitest";
import {
  Endpoint,
  STREAM_WINDOW,
  type StreamPort,
  type Transport,
  type Wire,
} from "../../../plugins/sandbox/rpc.js";

function pair(tokens: { host?: () => string | undefined } = {}) {
  const hostHandlers: Array<(m: Wire) => void> = [];
  const childHandlers: Array<(m: Wire) => void> = [];
  const sent: Wire[] = [];
  // structuredClone stands in for the IPC channel's advanced serialization.
  const hostTransport: Transport = {
    send: (m) => {
      sent.push(m);
      const copy = structuredClone(m);
      setImmediate(() => childHandlers.forEach((h) => h(copy)));
    },
    onMessage: (h) => hostHandlers.push(h),
  };
  const childTransport: Transport = {
    send: (m) => {
      const copy = structuredClone(m);
      setImmediate(() => hostHandlers.forEach((h) => h(copy)));
    },
    onMessage: (h) => childHandlers.push(h),
  };
  const seenByHost: Array<string | undefined> = [];
  const host = new Endpoint(hostTransport, {
    side: "h",
    outboundToken: tokens.host ?? (() => undefined),
    inbound: (token, run) => {
      seenByHost.push(token);
      return run();
    },
  });
  let childToken: string | undefined;
  const child = new Endpoint(childTransport, {
    side: "c",
    outboundToken: () => childToken,
    inbound: (token, run) => {
      const previous = childToken;
      childToken = token;
      try {
        return run();
      } finally {
        childToken = previous;
      }
    },
  });
  return {
    host,
    child,
    seenByHost,
    sent,
    setChildToken: (t?: string) => (childToken = t),
  };
}

describe("sandbox rpc", () => {
  it("calls a handler and returns its value", async () => {
    const { host, child } = pair();
    host.handle("add", ([a, b]) => (a as number) + (b as number));
    await expect(child.call("add", [2, 3])).resolves.toBe(5);
  });

  it("carries errors with their status and code", async () => {
    const { host, child } = pair();
    host.handle("boom", () => {
      const error = new Error("nope") as Error & {
        status: number;
        code: string;
      };
      error.status = 403;
      error.code = "X";
      throw error;
    });
    await expect(child.call("boom")).rejects.toMatchObject({
      message: "nope",
      status: 403,
      code: "X",
    });
  });

  it("refuses a method the other side never registered", async () => {
    const { child } = pair();
    await expect(child.call("ctx.anything")).rejects.toMatchObject({
      code: "SANDBOX_UNKNOWN",
    });
  });

  it("passes functions both ways as callable handles", async () => {
    const { host, child } = pair();
    host.handle("every", async ([fn]) => {
      const results = [];
      for (let i = 0; i < 3; i++)
        results.push(await (fn as (n: number) => Promise<number>)(i));
      return { results, dispose: () => "disposed" };
    });
    const outcome = (await child.call("every", [(n: number) => n * 10])) as {
      results: number[];
      dispose: () => Promise<string>;
    };
    expect(outcome.results).toEqual([0, 10, 20]);
    await expect(outcome.dispose()).resolves.toBe("disposed");
  });

  it("sends the child's current token with each call", async () => {
    const { host, child, seenByHost, setChildToken } = pair();
    host.handle("who", () => "ok");
    setChildToken("t-alice");
    await child.call("who");
    expect(seenByHost).toEqual(["t-alice"]);
  });

  it("runs a callback from core under the token core minted for it", async () => {
    let n = 0;
    const { host, child, seenByHost } = pair({ host: () => `minted-${++n}` });
    // The child's callback calls back into core; that call must carry the
    // token core minted for the callback, not one the child chose.
    host.handle("ping", () => "pong");
    host.handle("subscribe", async ([fn]) => (fn as () => Promise<unknown>)());
    child.handle("noop", () => null);
    await child.call("subscribe", [() => child.call("ping")]);
    expect(seenByHost).toContain("minted-1");
  });

  it("keeps Buffers as Buffers across the line", async () => {
    const { host, child } = pair();
    host.handle("echo", ([b]) => b);
    const out = (await child.call("echo", [Buffer.from("hi")])) as Buffer;
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString()).toBe("hi");
  });

  it("stops a stream sender at the window until the reader catches up", async () => {
    const { host, child } = pair();
    let port: StreamPort | null = null;
    host.handle("open", () => {
      port = host.openStream();
      return port;
    });
    const remote = (await child.call("open")) as StreamPort;
    const sender = port as unknown as StreamPort;

    const chunk = Buffer.alloc(64 * 1024, 1);
    let accepted = 0;
    // Nobody reads on the child side yet, so the sender must stall.
    for (let i = 0; i < 40; i++) {
      sender.write(chunk);
    }
    await new Promise((r) => setTimeout(r, 50));
    accepted = STREAM_WINDOW - sender.credit;
    expect(accepted).toBeLessThanOrEqual(STREAM_WINDOW + chunk.length);
    // Paused remote: the window plus its own buffer is all that moved.
    remote.pause();

    let received = 0;
    remote.on("data", (data: Buffer) => {
      received += data.length;
    });
    remote.resume();
    sender.end();
    await new Promise<void>((resolve) => remote.on("end", () => resolve()));
    expect(received).toBe(40 * chunk.length);
  });

  it("delivers stream end metadata (an exit code)", async () => {
    const { host, child } = pair();
    host.handle("run", () => {
      const port = host.openStream();
      setTimeout(() => {
        port.endMeta = { code: 3 };
        port.end();
      }, 5);
      return port;
    });
    const remote = (await child.call("run")) as StreamPort;
    const meta = await new Promise((resolve) =>
      remote.on("remote-end", resolve),
    );
    remote.resume();
    expect(meta).toEqual({ code: 3 });
  });

  it("survives a stream the other side fails, even with nobody listening", async () => {
    const { host, child } = pair();
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on("uncaughtException", onUncaught);
    try {
      host.handle("open", () => {
        const port = host.openStream();
        setTimeout(() => port.destroy(new Error("far end failed")), 5);
        return port;
      });
      const remote = (await child.call("open")) as StreamPort;
      await new Promise((resolve) => remote.once("close", resolve));
      // Both ends are gone; a late echo of the failure is dropped.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(uncaught).toEqual([]);
      expect(remote.destroyed).toBe(true);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });
});

describe("process transport", () => {
  it("drops a message for a process that is gone instead of throwing", async () => {
    const { processTransport } =
      await import("../../../plugins/sandbox/rpc.js");
    const errors: unknown[] = [];
    const onUncaught = (error: unknown) => errors.push(error);
    process.on("uncaughtException", onUncaught);
    try {
      const closed = processTransport({
        connected: false,
        send: () => {
          throw new Error("should not be called");
        },
        on: () => undefined,
      });
      expect(() => closed.send({ t: "ok", id: 1 } as never)).not.toThrow();
      const throwing = processTransport({
        connected: true,
        send: () => {
          throw Object.assign(new Error("channel closed"), {
            code: "ERR_IPC_CHANNEL_CLOSED",
          });
        },
        on: () => undefined,
      });
      expect(() => throwing.send({ t: "ok", id: 2 } as never)).not.toThrow();
      let callback: ((error: Error | null) => void) | undefined;
      const late = processTransport({
        connected: true,
        send: (_message, cb) => {
          callback = cb;
          return false;
        },
        on: () => undefined,
      });
      late.send({ t: "ok", id: 3 } as never);
      // Node reports EPIPE to the callback when one is given.
      expect(typeof callback).toBe("function");
      callback?.(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(errors).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });
});
