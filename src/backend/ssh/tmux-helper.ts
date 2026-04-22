import type { Client, ClientChannel } from "ssh2";
import { sshLogger } from "../utils/logger.js";

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

/**
 * Detect whether tmux is installed and list all existing sessions with details.
 */
export async function detectTmux(conn: Client): Promise<TmuxDetectionResult> {
  try {
    await execCommand(conn, "command -v tmux");
  } catch {
    return { available: false, sessions: [] };
  }

  let sessions: TmuxSessionInfo[] = [];
  try {
    const output = await execCommand(
      conn,
      `tmux list-sessions -F "#{session_name}|#{session_created}|#{session_activity}|#{session_windows}|#{session_attached}" 2>/dev/null`,
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

// tmux options applied on every attach/create:
// - mouse on: enables mouse wheel / touch scrollback through tmux history
// - history-limit: deep scrollback buffer on the remote host
// - set-clipboard on: use OSC 52 to sync tmux selections to the client clipboard
// - mode-keys vi: use vi-style keys in copy mode
// - MouseDragEnd: stop the selection but keep it highlighted so the user can
//   adjust and press Enter to copy (or drag again)
// - Enter: copy the (possibly adjusted) selection and exit copy mode
// - pane-mode-changed hook: on copy-mode entry, show a brief hint so users
//   know to press Enter to copy the selection
// Using -q on set/set-hook to suppress errors on older tmux versions that don't support
// a particular option (e.g. set-clipboard on tmux < 2.5). Note: set-hook doesn't support -q.
const TMUX_OPTS =
  `set -gq mouse on` +
  ` \\; set -gq history-limit 50000` +
  ` \\; set -gq set-clipboard on` +
  ` \\; set -gq mode-keys vi` +
  ` \\; bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X stop-selection` +
  ` \\; bind-key -T copy-mode-vi Enter send-keys -X copy-selection-and-cancel` +
  ` \\; set-hook -g pane-mode-changed` +
  ` 'if -F "#{pane_in_mode}"` +
  ` "display-message -d 2500 \\"Adjust selection and press Enter to copy\\""'`;

/**
 * Write tmux attach or new-session command to the interactive shell stream.
 * Uses && exit so the shell only closes if tmux started successfully.
 */
export function attachOrCreateTmuxSession(
  stream: ClientChannel,
  existingSessionName?: string,
): void {
  let command: string;
  if (existingSessionName) {
    command = `tmux ${TMUX_OPTS} \\; attach-session -t ${shellEscape(existingSessionName)} && exit\r`;
  } else {
    command = `tmux ${TMUX_OPTS} \\; new-session && exit\r`;
  }

  sshLogger.info("Writing tmux command to shell", {
    operation: "tmux_attach_or_create",
    sessionName: existingSessionName || "(auto)",
    isReattach: !!existingSessionName,
  });

  stream.write(command);
}

/**
 * Query the name of the most recently created tmux session via exec channel.
 */
export async function queryNewestTmuxSession(
  conn: Client,
): Promise<string | null> {
  try {
    const output = await execCommand(
      conn,
      `tmux list-sessions -F "#{session_created}:#{session_name}" 2>/dev/null | sort -rn | head -1 | cut -d: -f2-`,
    );
    return output || null;
  } catch {
    return null;
  }
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
