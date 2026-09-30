import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import type { PluginSshConnectOptions } from "@termix/plugin-sdk/backend";
import { createMockCtx } from "@termix/plugin-sdk/testing";
import { createC2SRelay } from "../../src/backend/c2s-relay.js";
import { host, manifest } from "./helpers.js";
class Socket extends EventEmitter {
  readyState = 1;
  send = vi.fn();
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  message(value: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(value)), false);
  }
  get ws() {
    return this as unknown as WebSocket;
  }
  messages() {
    return this.send.mock.calls.map(([data]) => JSON.parse(String(data)));
  }
}

describe("interactive client relay", () => {
  it("authenticates preflight once and forwards subsequent SOCKS streams on the retained connection", async () => {
    const mock = createMockCtx({
      pluginId: "tunnels",
      manifest,
      capabilities: manifest.capabilities,
      permissions: ["tunnels.use"],
      hosts: [host()],
    });
    const stream = new PassThrough();
    const client = Object.assign(new EventEmitter(), {
      forwardOut: vi.fn((_ip, _port, _target, _targetPort, callback) =>
        callback(null, stream),
      ),
    });
    const dispose = vi.fn();
    const connect = vi.fn(
      async (_id: number, options: PluginSshConnectOptions) => {
        expect(
          await options.prompt!.ask({
            kind: "totp",
            prompt: "Verification code:",
            retry: false,
          }),
        ).toBe("123456");
        return { client, dispose, host: host(), jumpClient: null };
      },
    );
    mock.ctx.ssh.connect = connect as typeof mock.ctx.ssh.connect;
    const handle = createC2SRelay(mock.ctx);
    const anchor = new Socket();
    const socket = new Socket();
    const tunnelConfig = {
      sourceHostId: 7,
      mode: "dynamic",
      sessionId: "desktop-runtime",
    };
    try {
      handle(anchor.ws, "user-1");
      anchor.message({ type: "test", keepAlive: true, tunnelConfig });
      await vi.waitFor(() =>
        expect(anchor.messages()[0]?.type).toBe("auth-prompt"),
      );
      anchor.message({
        type: "auth-response",
        requestId: anchor.messages()[0].requestId,
        answer: "123456",
      });
      await vi.waitFor(() =>
        expect(anchor.messages().at(-1)?.type).toBe("ready"),
      );
      expect(dispose).not.toHaveBeenCalled();
      handle(socket.ws, "user-1");
      socket.message({
        type: "open",
        tunnelConfig,
        targetHost: "internal.example",
        targetPort: 443,
      });
      await vi.waitFor(() =>
        expect(socket.messages().at(-1)?.type).toBe("ready"),
      );
      expect(connect).toHaveBeenCalledOnce();
      expect(client.forwardOut).toHaveBeenCalledWith(
        "127.0.0.1",
        0,
        "internal.example",
        443,
        expect.any(Function),
      );
      socket.close();
      expect(dispose).not.toHaveBeenCalled();
      anchor.close();
      await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    } finally {
      socket.close();
      anchor.close();
      stream.destroy();
      for (const cleanup of mock.disposals) await cleanup();
    }
  });
});
