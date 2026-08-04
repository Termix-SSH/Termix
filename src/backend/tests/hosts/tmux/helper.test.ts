import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import type { Client } from "ssh2";
import { describe, expect, it } from "vitest";
import {
  detectTmux,
  tmuxCommand,
  withTmuxPath,
} from "../../../hosts/tmux/helper.js";

describe("tmux command path handling", () => {
  it("prepends all non-login tmux paths while preserving inherited PATH", () => {
    expect(withTmuxPath("command -v tmux")).toBe(
      `/bin/sh -c 'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/bin:/usr/pkg/bin:"$PATH"; export PATH; command -v tmux'`,
    );
  });

  it("shell-escapes embedded single quotes in wrapped commands", () => {
    const command = withTmuxPath(`printf '%s' "can't"`);

    expect(execFileSync("/bin/sh", ["-c", command], { encoding: "utf8" })).toBe(
      "can't",
    );
  });

  it("runs every tmux invocation in UTF-8 mode through the path wrapper", () => {
    expect(tmuxCommand("list-sessions")).toBe(
      `/bin/sh -c 'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/bin:/usr/pkg/bin:"$PATH"; export PATH; tmux -u list-sessions'`,
    );
  });

  it("detects tmux with the UTF-8 wrapper", async () => {
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
    expect(commands).toEqual([
      `/bin/sh -c 'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/bin:/usr/pkg/bin:"$PATH"; export PATH; tmux -u -V'`,
      `/bin/sh -c 'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/bin:/usr/pkg/bin:"$PATH"; export PATH; tmux -u list-sessions -F "#{session_name}|#{session_created}|#{session_activity}|#{session_windows}|#{session_attached}" 2>/dev/null'`,
    ]);
  });
});
