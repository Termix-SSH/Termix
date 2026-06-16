import type { Client } from "ssh2";
import { execCommand } from "../widgets/common-utils.js";

export type ElevationErrorCode = "SUDO_REQUIRED" | "SUDO_FAILED" | "NOT_SUDOER";

export class ElevationError extends Error {
  code: ElevationErrorCode;
  constructor(code: ElevationErrorCode, message: string) {
    super(message);
    this.name = "ElevationError";
    this.code = code;
  }
}

export interface ElevatedResult {
  stdout: string;
  stderr: string;
  code: number | null;
  usedSudo: boolean;
}

const PERMISSION_DENIED = [
  "permission denied",
  "operation not permitted",
  "must be run as root",
  "must be superuser",
  "you need to be root",
  "are you root",
  "access denied",
];

/**
 * Phrases sudo itself prints to STDERR when authentication or authorization
 * fails. We only match these against sudo's stderr (never command output), so a
 * command that happens to print "permission denied" on stdout is not mistaken
 * for a sudo failure.
 */
const SUDO_AUTH_FAILED = [
  "incorrect password",
  "a password is required",
  "a terminal is required",
  "no tty present",
  "sorry, try again",
  "no password was provided",
  "1 incorrect password attempt",
];

const SUDO_NOT_SUDOER = [
  "is not in the sudoers file",
  "not allowed to run sudo",
  "not allowed to execute",
];

/**
 * Marker printed only after sudo has successfully authenticated and started the
 * inner shell. Its presence on stdout is the authoritative "elevation worked"
 * signal; its absence (together with sudo stderr) means auth failed.
 */
const SUDO_OK_MARKER = "__TX_SUDO_OK__";
const SUDO_OK_LINE_RE = new RegExp(`^${SUDO_OK_MARKER}\\r?\\n?`);

/** Escape a value for single-quoted shell context. */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

/**
 * Build the elevated command string:
 *   echo '<pw>' | sudo -S -p '' sh -c 'echo __TX_SUDO_OK__; <command>'
 *
 * `-p ''` suppresses the prompt. stderr is NOT merged into stdout, so the
 * command's own output stays clean and sudo's auth errors stay on stderr. The
 * marker is echoed by the inner shell once sudo authenticates, letting us tell a
 * genuine auth failure from command output that merely contains scary words.
 */
export function buildSudoCommand(
  command: string,
  sudoPassword: string,
): string {
  const pw = shellSingleQuote(sudoPassword);
  const inner = shellSingleQuote(`echo ${SUDO_OK_MARKER}; ${command}`);
  return `echo ${pw} | sudo -S -p '' sh -c ${inner}`;
}

function includesAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

function looksLikePermissionDenied(text: string): boolean {
  return includesAny(text, PERMISSION_DENIED);
}

/** Strip the success marker line from the front of stdout. */
function stripMarker(stdout: string): string {
  return stdout.replace(SUDO_OK_LINE_RE, "");
}

/**
 * Run a command on a pooled client, elevating with the host's stored sudo
 * password only when needed (or when forced). Throws a typed `ElevationError`
 * when elevation is required but unavailable/incorrect.
 */
export async function execElevated(
  client: Client,
  command: string,
  sudoPassword: string | undefined,
  opts: { forceSudo?: boolean; timeoutMs?: number } = {},
): Promise<ElevatedResult> {
  const timeoutMs = opts.timeoutMs ?? 30000;

  if (!opts.forceSudo) {
    const direct = await execCommand(client, command, timeoutMs);
    if (direct.code === 0) {
      return { ...direct, usedSudo: false };
    }
    // Only escalate when the failure looks like a privilege problem. A
    // permission-denied phrase on stderr (not arbitrary stdout) is the signal.
    if (!looksLikePermissionDenied(direct.stderr)) {
      return { ...direct, usedSudo: false };
    }
    if (!sudoPassword) {
      throw new ElevationError(
        "SUDO_REQUIRED",
        "This action requires elevated privileges. Set a sudo password for this host to continue.",
      );
    }
  } else if (!sudoPassword) {
    throw new ElevationError(
      "SUDO_REQUIRED",
      "This action requires elevated privileges. Set a sudo password for this host to continue.",
    );
  }

  const sudoCmd = buildSudoCommand(command, sudoPassword as string);
  const result = await execCommand(client, sudoCmd, timeoutMs);
  const authenticated = result.stdout.includes(SUDO_OK_MARKER);

  if (!authenticated) {
    // Elevation never started: diagnose from sudo's stderr only.
    const notSudoer = includesAny(result.stderr, SUDO_NOT_SUDOER);
    const authFailed = includesAny(result.stderr, SUDO_AUTH_FAILED);
    if (notSudoer) {
      throw new ElevationError(
        "NOT_SUDOER",
        "The connected user is not permitted to use sudo on this host.",
      );
    }
    if (authFailed) {
      throw new ElevationError(
        "SUDO_FAILED",
        "Elevation failed. Check the host's sudo password.",
      );
    }
    // No marker and no recognizable sudo error: treat as a generic failure but
    // keep the original output so the caller can surface it.
    throw new ElevationError(
      "SUDO_FAILED",
      "Elevation failed. Check the host's sudo password.",
    );
  }

  return {
    stdout: stripMarker(result.stdout),
    stderr: result.stderr,
    code: result.code,
    usedSudo: true,
  };
}
