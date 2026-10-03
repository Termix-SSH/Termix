import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createFakeContext } from "@termix/plugin-sdk/testing";
import { createTmuxSessionsService } from "../../src/backend/service.js";

function fakeSshClient(outputs: Record<string, string>, exitCode = 0) {
  const client = new EventEmitter() as EventEmitter & {
    exec: (
      command: string,
      cb: (err: Error | null, stream: unknown) => void,
    ) => void;
  };
  client.exec = (command, cb) => {
    const stream = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
    };
    stream.stderr = new EventEmitter();
    const matchKey = Object.keys(outputs).find((k) => command.includes(k));
    const output = matchKey ? outputs[matchKey] : "";
    cb(null, stream);
    setImmediate(() => {
      if (output) stream.emit("data", Buffer.from(output));
      stream.emit("close", exitCode);
    });
  };
  return client;
}

describe("createTmuxSessionsService", () => {
  it("detect() reports unavailable when tmux -V fails", async () => {
    const { ctx } = createFakeContext({ pluginId: "tmux-monitor" });
    const service = createTmuxSessionsService(ctx);
    const client = fakeSshClient({}, 127);

    await expect(service.detect(client)).resolves.toEqual({
      available: false,
      sessions: [],
    });
  });

  it("detect() lists full session info when tmux is available", async () => {
    const { ctx } = createFakeContext({ pluginId: "tmux-monitor" });
    const service = createTmuxSessionsService(ctx);
    const client = fakeSshClient({
      "-V": "tmux 3.7b\n",
      "list-sessions": "main|1|2|3|1\nlogs|4|5|1|0\n",
    });

    await expect(service.detect(client)).resolves.toEqual({
      available: true,
      sessions: [
        {
          name: "main",
          created: 1,
          lastActivity: 2,
          windows: 3,
          attachedClients: 1,
        },
        {
          name: "logs",
          created: 4,
          lastActivity: 5,
          windows: 1,
          attachedClients: 0,
        },
      ],
    });
  });

  it("attachOrCreate() writes the attach command to the stream", async () => {
    const { ctx } = createFakeContext({ pluginId: "tmux-monitor" });
    const service = createTmuxSessionsService(ctx);
    const writes: string[] = [];
    const stream = { write: (data: string) => writes.push(data) };

    await service.attachOrCreate(stream, "main");

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("attach-session -t");
    expect(writes[0]).toContain("main");
  });

  it("uses the host's saved mouse setting when attaching", async () => {
    const { ctx } = createFakeContext({ pluginId: "tmux-monitor" });
    await ctx.settings.setHost(7, "mouseEnabled", false);
    const writes: string[] = [];
    const service = createTmuxSessionsService(ctx);
    await service.attachOrCreate(
      { write: (value: string) => writes.push(value) },
      "main",
      undefined,
      7,
    );
    await service.attachOrCreate(
      { write: (value: string) => writes.push(value) },
      "other",
      undefined,
      8,
    );
    expect(writes[0]).toContain("mouse off");
    expect(writes[1]).toContain("mouse on");
  });

  it("waitForSession() falls back to the requested name on timeout", async () => {
    vi.useFakeTimers();
    try {
      const { ctx } = createFakeContext({ pluginId: "tmux-monitor" });
      const warn = vi.fn();
      ctx.log.warn = warn;
      const service = createTmuxSessionsService(ctx);
      const client = fakeSshClient({}, 1);

      const result = service.waitForSession(client, "new-session");
      await vi.advanceTimersByTimeAsync(5100);

      await expect(result).resolves.toBe("new-session");
      expect(warn).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
