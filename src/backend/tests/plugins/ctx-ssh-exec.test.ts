import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runExec, type ExecClient } from "../../plugins/ctx-ssh-exec.js";

function fakeClient(
  script: (stream: FakeStream) => void,
  execError?: Error,
): ExecClient & { commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    exec: (command, callback) => {
      commands.push(command);
      if (execError) return callback(execError, undefined as never);
      const stream = new FakeStream();
      callback(undefined, stream as never);
      script(stream);
    },
  };
}

class FakeStream extends EventEmitter {
  stderr = new EventEmitter();
  written: string[] = [];
  closed = false;
  write(data: string) {
    this.written.push(data);
  }
  end(data?: string) {
    if (data !== undefined) this.written.push(data);
  }
  close() {
    this.closed = true;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runExec", () => {
  it("collects output and the exit code", async () => {
    const client = fakeClient((stream) => {
      stream.emit("data", Buffer.from("out"));
      stream.stderr.emit("data", Buffer.from("err"));
      stream.emit("close", 3);
    });
    await expect(runExec(client, "echo hi")).resolves.toEqual({
      stdout: "out",
      stderr: "err",
      code: 3,
      truncated: false,
      timedOut: false,
    });
    expect(client.commands).toEqual(["echo hi"]);
  });

  it("keeps only maxOutputBytes and says so", async () => {
    const client = fakeClient((stream) => {
      stream.emit("data", Buffer.alloc(3000, "a"));
      stream.emit("close", 0);
    });
    const result = await runExec(client, "yes", { maxOutputBytes: 1024 });
    expect(result.stdout).toHaveLength(1024);
    expect(result.truncated).toBe(true);
  });

  it("writes stdin and closes it", async () => {
    let seen: FakeStream | undefined;
    const client = fakeClient((stream) => {
      seen = stream;
      stream.emit("close", 0);
    });
    await runExec(client, "cat >> f", { stdin: "key\n" });
    expect(seen?.written).toEqual(["key\n"]);
  });

  it("stops a command that runs past the time limit", async () => {
    vi.useFakeTimers();
    let seen: FakeStream | undefined;
    const client = fakeClient((stream) => {
      seen = stream;
    });
    const pending = runExec(client, "sleep 999", { timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(2100);
    const result = await pending;
    expect(result).toMatchObject({ code: null, timedOut: true });
    expect(seen?.closed).toBe(true);
  });

  it("rejects when the exec itself fails", async () => {
    const client = fakeClient(() => {}, new Error("channel open failure"));
    await expect(runExec(client, "ls")).rejects.toThrow(/channel open/);
  });

  it("rejects an empty or oversized command before running it", async () => {
    const client = fakeClient(() => {});
    await expect(runExec(client, "  ")).rejects.toThrow(/required/);
    await expect(runExec(client, "x".repeat(70_000))).rejects.toThrow(
      /too long/,
    );
    expect(client.commands).toEqual([]);
  });
});
