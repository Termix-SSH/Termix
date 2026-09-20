import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  ChannelOpenSerializer,
  execBuffer,
  execWithSudoBuffer,
  type SSHSession,
} from "../../../hosts/file-manager/session.js";

function setupSession() {
  const stream = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    close: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  };
  stream.stderr = new EventEmitter();
  stream.close = vi.fn();
  stream.write = vi.fn();

  const exec = vi.fn(
    (
      _command: string,
      callback: (error: undefined, channel: typeof stream) => void,
    ) => callback(undefined, stream),
  );
  const session = {
    client: { exec },
    channelOpener: new ChannelOpenSerializer(),
  } as unknown as SSHSession;

  return { exec, session, stream };
}

describe("file-manager command helpers", () => {
  it("writes the sudo password to stdin instead of the command line", async () => {
    const { exec, session, stream } = setupSession();
    const resultPromise = execWithSudoBuffer(
      session,
      "cat '/root/secret.txt'",
      "private password",
    );

    await vi.waitFor(() => expect(stream.write).toHaveBeenCalled());
    expect(exec).toHaveBeenCalledWith(
      "sudo -S -p '' cat '/root/secret.txt' 2>&1",
      expect.any(Function),
    );
    expect(exec.mock.calls[0][0]).not.toContain("private password");
    expect(stream.write).toHaveBeenCalledWith("private password\n");

    stream.emit("close", 0);
    await expect(resultPromise).resolves.toMatchObject({ code: 0 });
  });

  it("closes the channel when stdout exceeds the configured limit", async () => {
    const { session, stream } = setupSession();
    const resultPromise = execBuffer(session, "cat file", 4);

    await vi.waitFor(() => expect(stream.listenerCount("data")).toBe(1));
    stream.emit("data", Buffer.from("12345"));

    await expect(resultPromise).resolves.toMatchObject({
      code: 1,
      exceededLimit: true,
    });
    expect(stream.close).toHaveBeenCalledOnce();
  });
});
