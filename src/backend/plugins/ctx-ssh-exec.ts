/**
 * Runs one command on an open ssh2 client for ctx.ssh.exec, with a time limit
 * and caps on how much output is kept.
 */

import type { PluginSshExecOptions } from "@termix-ssh/plugin-sdk/backend";

export const EXEC_DEFAULT_TIMEOUT_MS = 30_000;
export const EXEC_MAX_TIMEOUT_MS = 10 * 60_000;
export const EXEC_DEFAULT_MAX_OUTPUT = 256 * 1024;
export const EXEC_HARD_MAX_OUTPUT = 4 * 1024 * 1024;
export const EXEC_MAX_COMMAND_LENGTH = 64 * 1024;

interface ExecStream {
  on: (event: string, listener: (...args: never[]) => void) => unknown;
  stderr: { on: (event: string, listener: (chunk: Buffer) => void) => unknown };
  write: (data: string) => unknown;
  end: (data?: string) => unknown;
  close: () => void;
}

export interface ExecClient {
  exec: (
    command: string,
    callback: (error: Error | undefined, stream: ExecStream) => void,
  ) => unknown;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** Null when the command was killed by a signal or hit the time limit. */
  code: number | null;
  truncated: boolean;
  timedOut: boolean;
}

export function runExec(
  client: ExecClient,
  command: string,
  options: PluginSshExecOptions = {},
): Promise<ExecResult> {
  if (typeof command !== "string" || command.trim() === "") {
    return Promise.reject(new Error("A command is required"));
  }
  if (command.length > EXEC_MAX_COMMAND_LENGTH) {
    return Promise.reject(new Error("The command is too long"));
  }
  const timeoutMs = Math.min(
    EXEC_MAX_TIMEOUT_MS,
    Math.max(1000, options.timeoutMs ?? EXEC_DEFAULT_TIMEOUT_MS),
  );
  const maxOutput = Math.min(
    EXEC_HARD_MAX_OUTPUT,
    Math.max(1024, options.maxOutputBytes ?? EXEC_DEFAULT_MAX_OUTPUT),
  );

  return new Promise<ExecResult>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let truncated = false;
    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | null = null;

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code, truncated, timedOut });
    };

    const append = (current: string, chunk: Buffer): string => {
      const room = maxOutput - Buffer.byteLength(current);
      if (room <= 0) {
        truncated = true;
        return current;
      }
      if (chunk.length > room) {
        truncated = true;
        return current + chunk.subarray(0, room).toString("utf8");
      }
      return current + chunk.toString("utf8");
    };

    client.exec(command, (error, stream) => {
      if (error) {
        if (!settled) {
          settled = true;
          reject(error);
        }
        return;
      }
      timer = setTimeout(() => {
        timedOut = true;
        try {
          stream.close();
        } catch {
          // already closed
        }
        finish(null);
      }, timeoutMs);

      stream.on("data", ((chunk: Buffer) => {
        stdout = append(stdout, chunk);
      }) as never);
      stream.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      stream.on("close", ((code: number | null | undefined) => {
        finish(typeof code === "number" ? code : null);
      }) as never);
      stream.on("error", ((streamError: Error) => {
        if (!settled) {
          settled = true;
          if (timer) clearTimeout(timer);
          reject(streamError);
        }
      }) as never);
      if (options.stdin !== undefined) stream.end(options.stdin);
    });
  });
}
