import { EventEmitter } from "events";
import { describe, expect, it } from "vitest";
import {
  buildSudoCommand,
  ElevationError,
  execElevated,
  sudoStdin,
} from "../../../../packages/plugin-sdk/src/host-commands.js";

const PASSWORD = "s3cret'pw";

class FakeStream extends EventEmitter {
  stderr = new EventEmitter();
  written = "";
  end(chunk?: string) {
    this.written += chunk ?? "";
  }
  destroy() {}
}

function recordingClient() {
  const calls: { command: string; stream: FakeStream }[] = [];
  const client = {
    exec: (
      command: string,
      _options: unknown,
      callback: (err: Error | undefined, stream: FakeStream) => void,
    ) => {
      const stream = new FakeStream();
      calls.push({ command, stream });
      callback(undefined, stream);
      setImmediate(() => {
        stream.emit("data", Buffer.from("__TX_SUDO_OK__\nok\n"));
        stream.emit("close", 0);
      });
    },
  };
  return { client: client as never, calls };
}

describe("GHSA-fvgh-cfcg-rx3g sudo password stays out of argv", () => {
  it("sends the password on stdin, never in the command", async () => {
    const { client, calls } = recordingClient();
    const result = await execElevated(client, "uptime", PASSWORD, {
      forceSudo: true,
    });
    expect(result.stdout).toBe("ok\n");
    expect(calls).toHaveLength(1);
    expect(calls[0].command).not.toContain("s3cret");
    expect(calls[0].stream.written).toBe(`${PASSWORD}\n`);
  });

  it("builds a command with no password in it", () => {
    const command = buildSudoCommand("uptime");
    expect(command).toContain("read -r P");
    expect(command).toContain("sudo -k -S -p");
    expect(command).not.toMatch(/echo '[^_]/);
  });

  it("refuses a password with a line break", () => {
    expect(() => sudoStdin("a\nb")).toThrow(ElevationError);
  });
});
