import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client, ClientChannel } from "ssh2";
import { describe, expect, it } from "vitest";
import {
  attachOrCreateTmuxSession,
  detectTmux,
  tmuxCommand,
  withTmuxPath,
} from "../../src/backend/tmux-commands.js";

describe("tmux command path handling", () => {
  it("prepends all non-login tmux paths while preserving inherited PATH", () => {
    expect(withTmuxPath("command -v tmux")).toBe(
      `/bin/sh -c 'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/bin:/usr/pkg/bin:"$PATH"; export PATH; command -v tmux'`,
    );
  });

  it("shell-escapes embedded single quotes in wrapped commands", () => {
    // Asserted as a string so the escaping rule is covered everywhere. The
    // round-trip below proves it against a real parser, but only where one
    // exists -- see the note there.
    expect(withTmuxPath(`printf '%s' "can't"`)).toBe(
      "/bin/sh -c 'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/bin:/usr/pkg/bin:\"$PATH\"; export PATH; printf '\\''%s'\\'' \"can'\\''t\"'",
    );
  });

  // /bin/sh is not on Windows, and Windows is a supported platform for the
  // desktop app -- contributors run `npm test` there. CI is ubuntu-only, so it
  // would never notice this failing.
  it.skipIf(process.platform === "win32")(
    "produces a command a real shell parses back to the original",
    () => {
      const command = withTmuxPath(`printf '%s' "can't"`);

      expect(
        execFileSync("/bin/sh", ["-c", command], { encoding: "utf8" }),
      ).toBe("can't");
    },
  );

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

describe("session-scoped tmux mouse", () => {
  it.skipIf(process.platform === "win32")(
    "passes an exact session target and literal separator through both shells",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "termix-tmux-"));
      try {
        writeFileSync(join(dir, "tmux"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
          mode: 0o755,
        });
        let command = "";
        const stream = {
          write: (value: string) => {
            command = value;
          },
        };
        const name = "qa's $(echo injected)";
        attachOrCreateTmuxSession(
          stream as unknown as ClientChannel,
          name,
          undefined,
          false,
        );
        expect(command.endsWith("\r")).toBe(true);
        const args = execFileSync("/bin/sh", ["-c", command.trim()], {
          encoding: "utf8",
          env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` },
        })
          .trim()
          .split("\n");
        expect(args).toEqual([
          "-u",
          "set-option",
          "-q",
          "-t",
          `=${name}`,
          "mouse",
          "off",
          ";",
          "set-option",
          "-q",
          "-t",
          `=${name}`,
          "history-limit",
          "50000",
          ";",
          "attach-session",
          "-t",
          `=${name}`,
        ]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("creates the named session before configuring and attaching it", () => {
    let command = "";
    attachOrCreateTmuxSession(
      {
        write: (value: string) => {
          command = value;
        },
      } as unknown as ClientChannel,
      undefined,
      "work",
    );
    expect(command.indexOf("new-session")).toBeLessThan(
      command.indexOf("set-option"),
    );
    expect(command.indexOf("set-option")).toBeLessThan(
      command.indexOf("attach-session"),
    );
    expect(command).toContain("mouse on");
    expect(command).toContain("history-limit 50000");
    expect(command).not.toMatch(/set -g|set-hook|bind-key|set-clipboard/);
  });
});
