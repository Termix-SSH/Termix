import { afterEach, expect, it, vi } from "vitest";
import { Duplex, PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { startServer, type TestServer } from "../helpers.js";
let server: TestServer;
afterEach(async () => {
  await server?.close();
});
it("dispatches FIFO once per completed turn and pauses pending work when cancelled", async () => {
  server = await startServer({
    permissions: ["ai.agents", "ai.manage_providers"],
  });
  await server.enableFor("user-1");
  const prompts: { text: string }[] = [];
  class Channel extends Duplex {
    stderr = new PassThrough();
    _read() {}
    _write(chunk: Buffer, _encoding: string, done: () => void) {
      const m = JSON.parse(chunk.toString());
      if (m.type === "start") this.complete();
      if (m.type === "prompt") prompts.push(m);
      if (m.type === "stop") {
        this.push(null);
        queueMicrotask(() => this.emit("close"));
      }
      done();
    }
    complete() {
      this.push(JSON.stringify({ kind: "status", text: "ready" }) + "\n");
    }
  }
  const channel = new Channel();
  const client = Object.assign(new EventEmitter(), {
    forwardIn: (
      _host: string,
      _port: number,
      callback: (error: null, port: number) => void,
    ) => callback(null, 30000),
    exec: (_cmd: string, callback: (error: null, ch: Channel) => void) =>
      callback(null, channel),
  });
  vi.spyOn(server.mock.ctx.ssh, "connect").mockResolvedValue({
    client,
    dispose: () => channel.destroy(),
  } as never);
  const p = await server.request("POST", "/providers", {
    body: {
      providerType: "openai",
      label: "Test",
      apiKey: "unused",
      defaultModel: "test",
    },
  });
  const started = await server.request("POST", "/agents", {
    body: {
      agent: "pi",
      hostId: 1,
      providerId: p.body.provider.id,
      model: "test",
      cwd: "/tmp",
    },
  });
  expect(started.status).toBe(201);
  const id = started.body.id;
  try {
    expect(
      (
        await server.request("POST", `/agents/${id}/input`, {
          body: { type: "prompt", text: "first" },
        })
      ).status,
    ).toBe(200);
    for (const text of ["second", "third"])
      expect(
        (
          await server.request("POST", `/agents/${id}/queue`, {
            body: { operation: "add", text },
          })
        ).status,
      ).toBe(200);
    expect(prompts.map((p) => p.text)).toEqual(["first"]);
    channel.complete();
    await vi.waitFor(() =>
      expect(prompts.map((p) => p.text)).toEqual(["first", "second"]),
    );
    await server.request("POST", `/agents/${id}/input`, {
      body: { type: "cancel" },
    });
    channel.complete();
    await vi.waitFor(async () =>
      expect((await server.request("GET", `/agents/${id}`)).body.status).toBe(
        "ready",
      ),
    );
    expect(prompts).toHaveLength(2);
    const paused = (await server.request("GET", `/agents/${id}`)).body;
    expect(paused.queuePaused).toBe(true);
    expect(paused.queue.map((p: { text: string }) => p.text)).toEqual([
      "third",
    ]);
    await server.request("POST", `/agents/${id}/queue`, {
      body: { operation: "continue" },
    });
    await vi.waitFor(() =>
      expect(prompts.map((p) => p.text)).toEqual(["first", "second", "third"]),
    );
  } finally {
    await server.request("POST", `/agents/${id}/stop`);
  }
});
