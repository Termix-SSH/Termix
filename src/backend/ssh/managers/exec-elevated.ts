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

const SUDO_PROMPT_RE = /^\[sudo\] password for .+?:\s*/;

/** Escape a value for single-quoted shell context. */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

/**
 * Build the elevated command string:
 *   echo '<pw>' | sudo -S -p '' sh -c '<command>' 2>&1
 * The inner command is wrapped in `sh -c` so compound commands/pipes run under
 * sudo as a single unit. `-p ''` suppresses the prompt; we still strip a leading
 * "[sudo] password for ...:" defensively.
 */
export function buildSudoCommand(
  command: string,
  sudoPassword: string,
): string {
  const pw = shellSingleQuote(sudoPassword);
  const inner = shellSingleQuote(command);
  return `echo ${pw} | sudo -S -p '' sh -c ${inner} 2>&1`;
}

function looksLikePermissionDenied(text: string): boolean {
  const lower = text.toLowerCase();
  return PERMISSION_DENIED.some((p) => lower.includes(p));
}

function looksLikeSudoFailure(text: string): {
  failed: boolean;
  notSudoer: boolean;
} {
  const lower = text.toLowerCase();
  const notSudoer =
    lower.includes("is not in the sudoers file") ||
    lower.includes("not allowed to run sudo");
  const failed =
    notSudoer ||
    lower.includes("incorrect password") ||
    lower.includes("a password is required") ||
    lower.includes("a terminal is required") ||
    lower.includes("sudo: no tty present") ||
    lower.includes("sorry, try again");
  return { failed, notSudoer };
}

function stripSudoPrompt(stdout: string): string {
  return stdout.replace(SUDO_PROMPT_RE, "");
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
    const combined = `${direct.stdout}\n${direct.stderr}`;
    if (!looksLikePermissionDenied(combined)) {
      // Failed for a non-permission reason; surface as-is (caller decides).
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
  const stdout = stripSudoPrompt(result.stdout);
  const combined = `${stdout}\n${result.stderr}`;
  const { failed, notSudoer } = looksLikeSudoFailure(combined);
  if (failed) {
    throw new ElevationError(
      notSudoer ? "NOT_SUDOER" : "SUDO_FAILED",
      notSudoer
        ? "The connected user is not permitted to use sudo on this host."
        : "Elevation failed. Check the host's sudo password.",
    );
  }
  return { stdout, stderr: result.stderr, code: result.code, usedSudo: true };
}
