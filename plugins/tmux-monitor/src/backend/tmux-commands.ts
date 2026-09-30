import { randomUUID } from "node:crypto";
import type { Client, ClientChannel } from "ssh2";

const TMUX_PATH_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/opt/bin",
  "/usr/pkg/bin",
];

export function withTmuxPath(command: string): string {
  const script = `PATH=${TMUX_PATH_DIRS.join(":")}:"$PATH"; export PATH; ${command}`;
  return `/bin/sh -c ${shellEscape(script)}`;
}

export function tmuxCommand(args: string): string {
  return withTmuxPath(`tmux -u ${args}`);
}

/**
 * Run a command on the remote host via a separate exec channel.
 * Returns stdout as a string. Does not pollute the interactive shell.
 */
export function execCommand(conn: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let stdout = "";
      let stderr = "";
      stream.on("data", (data: Buffer) => {
        stdout += data.toString("utf-8");
      });
      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString("utf-8");
      });
      stream.on("error", (err: Error) => {
        reject(err);
      });
      stream.on("close", (code: number) => {
        if (code !== 0 && stdout === "") {
          reject(
            new Error(stderr.trim() || `Command exited with code ${code}`),
          );
        } else {
          resolve(stdout.trim());
        }
      });
    });
  });
}

export interface TmuxSessionInfo {
  name: string;
  created: number;
  lastActivity: number;
  windows: number;
  attachedClients: number;
}

export interface TmuxDetectionResult {
  available: boolean;
  sessions: TmuxSessionInfo[];
}

/**
 * Detect whether tmux is installed and list all existing sessions with details.
 */
export async function detectTmux(conn: Client): Promise<TmuxDetectionResult> {
  try {
    await execCommand(conn, tmuxCommand("-V"));
  } catch {
    return { available: false, sessions: [] };
  }

  let sessions: TmuxSessionInfo[] = [];
  try {
    const output = await execCommand(
      conn,
      tmuxCommand(
        `list-sessions -F "#{session_name}|#{session_created}|#{session_activity}|#{session_windows}|#{session_attached}" 2>/dev/null`,
      ),
    );
    if (output) {
      sessions = output
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => {
          const [name, created, activity, windows, attached] = line.split("|");
          return {
            name,
            created: parseInt(created, 10) || 0,
            lastActivity: parseInt(activity, 10) || 0,
            windows: parseInt(windows, 10) || 0,
            attachedClients: parseInt(attached, 10) || 0,
          };
        });
    }
  } catch {
    // tmux server not running yet -- no sessions exist
  }

  return { available: true, sessions };
}

/**
 * Wait for a tmux session to appear by polling via exec channel.
 * Returns the session name once found, or null on timeout.
 */
export async function waitForTmuxSession(
  conn: Client,
  sessionName: string,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await execCommand(
        conn,
        tmuxCommand(`has-session -t ${shellEscape(sessionName)} 2>/dev/null`),
      );
      return sessionName;
    } catch {
      // session not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

/**
 * Write tmux attach or new-session command to the interactive shell stream.
 * Uses && exit so the shell only closes if tmux started successfully.
 *
 * Options are set on this session only so the user's own tmux config stays
 * untouched. -q keeps an older tmux that lacks an option from aborting the
 * attach.
 */
export function attachOrCreateTmuxSession(
  stream: ClientChannel,
  existingSessionName?: string,
  newSessionName?: string,
  mouseEnabled = true,
): void {
  const name =
    existingSessionName || newSessionName || `termix-${randomUUID()}`;
  const target = shellEscape(`=${name}`);
  const commands = existingSessionName
    ? []
    : [`new-session -d -s ${shellEscape(name)}`];
  commands.push(
    `set-option -q -t ${target} mouse ${mouseEnabled ? "on" : "off"}`,
    `set-option -q -t ${target} history-limit 50000`,
    `attach-session -t ${target}`,
  );
  stream.write(`${tmuxCommand(commands.join(" \\; "))} && exit\r`);
}

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
