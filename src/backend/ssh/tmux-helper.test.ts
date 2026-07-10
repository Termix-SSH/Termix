import { EventEmitter } from "node:events";
import type { Client } from "ssh2";
import { describe, expect, it } from "vitest";
import { detectTmux, tmuxCommand, withTmuxPath } from "./tmux-helper.js";

describe("tmux command path handling", () => {
  it("adds common non-login shell tmux paths", () => {
    const command = withTmuxPath("command -v tmux");

    expect(command).toMatch(/^\/bin\/sh -c '/);
    expect(command).toContain("/opt/homebrew/bin");
    expect(command).toContain("/usr/local/bin");
    expect(command).toContain("/opt/bin");
    expect(command).toContain("/usr/pkg/bin");
    expect(command).toContain(":$PATH; export PATH; command -v tmux");
  });

  it("wraps tmux invocations with the same path", () => {
    expect(tmuxCommand("list-sessions")).toMatch(
      /^\/bin\/sh -c 'PATH=.*:\$PATH; export PATH; tmux list-sessions'$/,
    );
  });

  it("detects suffixed tmux versions without parsing the version number", async () => {
    const commands: string[] = [];
    const conn = {
      exec(command: string, callback: (error: null, stream: never) => void) {
        commands.push(command);
        const stream = new EventEmitter() as EventEmitter & {
          stderr: EventEmitter;
        };
        stream.stderr = new EventEmitter();
        callback(null, stream as never);

        queueMicrotask(() => {
          if (commands.length === 1) {
            stream.emit("data", Buffer.from("tmux 3.7b\n"));
            stream.emit("close", 0);
            return;
          }
          stream.emit("close", 1);
        });
      },
    } as unknown as Client;

    await expect(detectTmux(conn)).resolves.toEqual({
      available: true,
      sessions: [],
    });
    expect(commands[0]).toContain("tmux -V");
  });
});
