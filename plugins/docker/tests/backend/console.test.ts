import { EventEmitter } from "node:events";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMockCtx,
  type MockPluginContext,
} from "@termix/plugin-sdk/testing";
import type { PluginWebSocketConnection } from "@termix/plugin-sdk/backend";
import { activate } from "../../src/backend/index.js";
import { manifest, sshHost } from "./server";
import { FakeClient, FakeStream } from "./fake-ssh";

/** A ws WebSocket as far as the console uses one. */
class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];
  closedWith: [number, string] | null = null;

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  ping() {}

  close(code: number, reason: string) {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.closedWith = [code, reason];
    this.emit("close");
  }

  message(payload: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(payload)));
  }
}

function consoleClient() {
  const shells: FakeStream[] = [];
  const client = new FakeClient([
    [/which bash/, { stdout: "/bin/bash\n" }],
    [/exec -it abc123 \/bin\/bash/, (stream) => shells.push(stream)],
  ]);
  return { client, shells };
}

async function activated(client: FakeClient): Promise<MockPluginContext> {
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    router: () => express.Router(),
    permissions: ["docker.use"],
    sshHosts: [sshHost(7)],
    sshClient: client,
  });
  await mock.ctx.settings.setHost(7, "enableDocker", true);
  // Like the runtime, disposing a connection ends its client.
  const connect = mock.ctx.ssh.connect;
  mock.ctx.ssh.connect = (async (...args: Parameters<typeof connect>) => ({
    ...(await connect(...args)),
    dispose: () => client.end(),
  })) as typeof connect;
  await activate(mock.ctx);
  return mock;
}

async function openConsole(mock: MockPluginContext, userId = "user-1") {
  const route = mock.wsRoutes.find((r) => r.path === "/console");
  expect(route?.options).toEqual({ public: true, optionalAuth: true });
  const socket = new FakeSocket();
  mock.setActor(userId || undefined);
  await route!.handler!({
    userId,
    request: {},
    socket,
    clientIp: "127.0.0.1",
    requestOrigin: "http://localhost",
    isDataUnlocked: () => true,
  } as PluginWebSocketConnection);
  return socket;
}

async function until(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(check()).toBe(true);
}

let disposals: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposals.reverse()) await dispose();
  disposals = [];
});

describe("docker console", () => {
  it("refuses a socket without a user", async () => {
    const mock = await activated(consoleClient().client);
    disposals.push(...mock.disposals);
    const socket = await openConsole(mock, "");
    expect(socket.closedWith?.[0]).toBe(1008);
  });

  it("closes an open console on disable, and the next enable works", async () => {
    const first = consoleClient();
    const mock = await activated(first.client);

    const socket = await openConsole(mock);
    socket.message({
      type: "connect",
      data: {
        hostConfig: { id: 7, ip: "10.0.0.7" },
        containerId: "abc123",
        shell: "bash",
        cols: 100,
        rows: 30,
      },
    });
    await until(() => socket.sent.some((m) => m.type === "connected"));
    socket.message({ type: "input", data: "ls\n" });
    await until(() => first.shells[0]?.written.includes("ls\n") ?? false);

    // Disable: the runtime empties the disposable bag.
    for (const dispose of [...mock.disposals].reverse()) await dispose();
    expect(first.shells[0].ended).toBe(true);
    expect(first.client.ended).toBe(true);
    expect(socket.closedWith?.[0]).toBe(1001);

    // Enable again: a fresh activate on the same module serves a new console.
    const second = consoleClient();
    const again = await activated(second.client);
    disposals.push(...again.disposals);
    const next = await openConsole(again);
    next.message({
      type: "connect",
      data: { hostConfig: { id: 7, ip: "10.0.0.7" }, containerId: "abc123" },
    });
    await until(() => next.sent.some((m) => m.type === "connected"));
    second.shells[0].emit("data", Buffer.from("hello"));
    await until(() =>
      next.sent.some((m) => m.type === "output" && m.data === "hello"),
    );
  });

  it("refuses a host id that resolves to another machine", async () => {
    const mock = await activated(consoleClient().client);
    disposals.push(...mock.disposals);
    const socket = await openConsole(mock);
    socket.message({
      type: "connect",
      data: { hostConfig: { id: 7, ip: "10.9.9.9" }, containerId: "abc123" },
    });
    await until(() => socket.sent.some((m) => m.type === "error"));
    expect(String(socket.sent[0].message)).toMatch(/Host mismatch/);
  });

  it("refuses a host with Docker switched off", async () => {
    const mock = await activated(consoleClient().client);
    disposals.push(...mock.disposals);
    await mock.ctx.settings.setHost(7, "enableDocker", false);
    const socket = await openConsole(mock);
    socket.message({
      type: "connect",
      data: { hostConfig: { id: 7, ip: "10.0.0.7" }, containerId: "abc123" },
    });
    await until(() => socket.sent.some((m) => m.type === "error"));
    expect(String(socket.sent[0].message)).toMatch(/not enabled/);
  });
});
