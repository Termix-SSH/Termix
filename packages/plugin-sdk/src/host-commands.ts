/**
 * Generic host command helpers: platform detection, package manager actions
 * and the shell-argument validators that guard them.
 *
 * Pure functions and thin ssh2 wrappers, no core imports. fleets and
 * host-metrics both build their platform/package features on this instead of
 * duplicating it or reaching into core.
 *
 * A plugin passes the `Client` it got from ctx.ssh.connect/withConnection.
 */

export type { Client, ClientChannel } from "ssh2";
import type { Client, ClientChannel } from "ssh2";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Runs one non-interactive command over an existing ssh2 client. */
export function execCommand(
  client: Client,
  command: string,
  timeoutMs = 30000,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stream: ClientChannel | null = null;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Command timeout after ${timeoutMs}ms: ${command}`));
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      if (stream) {
        try {
          stream.removeAllListeners();
          if (stream.stderr) {
            stream.stderr.removeAllListeners();
          }
          stream.destroy();
        } catch {
          // expected - cleanup errors ignored
        }
      }
    };

    client.exec(command, { pty: false }, (err, _stream) => {
      if (err) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
        return;
      }

      stream = _stream;
      let stdout = "";
      let stderr = "";
      let exitCode: number | null = null;

      stream
        .on("close", (code: number | undefined) => {
          if (!settled) {
            settled = true;
            exitCode = typeof code === "number" ? code : null;
            cleanup();
            resolve({ stdout, stderr, code: exitCode });
          }
        })
        .on("data", (data: Buffer) => {
          stdout += data.toString("utf8");
        })
        .on("error", (streamErr: Error) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(streamErr);
          }
        });

      if (stream.stderr) {
        stream.stderr
          .on("data", (data: Buffer) => {
            stderr += data.toString("utf8");
          })
          .on("error", (stderrErr: Error) => {
            if (!settled) {
              settled = true;
              cleanup();
              reject(stderrErr);
            }
          });
      }
    });
  });
}

export type PackageManager = "apt" | "dnf" | "yum" | "pacman" | null;

export interface PlatformInfo {
  hasSystemd: boolean;
  pkg: PackageManager;
  hasCertbot: boolean;
  hasAcmeSh: boolean;
  hasDocker: boolean;
  osPrettyName: string | null;
}

/**
 * Non-interactive SSH shells don't source ~/.zprofile or ~/.bash_profile,
 * so PATH additions from installers like Homebrew or OrbStack are missing.
 * Extend PATH with their common install locations before probing.
 */
export const EXTRA_PATH_DIRS =
  '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:"$HOME/.orbstack/bin"';

const DOCKER_PROBE =
  `command -v docker >/dev/null 2>&1` +
  ` || [ -S /var/run/docker.sock ]` +
  ` || [ -S "$HOME/.orbstack/run/docker.sock" ]`;

/**
 * Single probe that reports which tooling is available. Each line is
 * "key=value" so the parser is trivial and order-independent.
 */
export const PLATFORM_PROBE_COMMAND = [
  `PATH="${EXTRA_PATH_DIRS}:$PATH"`,
  "echo systemd=$(command -v systemctl >/dev/null 2>&1 && echo 1 || echo 0)",
  "echo apt=$(command -v apt-get >/dev/null 2>&1 && echo 1 || echo 0)",
  "echo dnf=$(command -v dnf >/dev/null 2>&1 && echo 1 || echo 0)",
  "echo yum=$(command -v yum >/dev/null 2>&1 && echo 1 || echo 0)",
  "echo pacman=$(command -v pacman >/dev/null 2>&1 && echo 1 || echo 0)",
  "echo certbot=$(command -v certbot >/dev/null 2>&1 && echo 1 || echo 0)",
  'echo acmesh=$( { command -v acme.sh >/dev/null 2>&1 || [ -x "$HOME/.acme.sh/acme.sh" ]; } && echo 1 || echo 0)',
  `echo docker=$(${DOCKER_PROBE} && echo 1 || echo 0)`,
  'echo os=$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")',
].join("; ");

export function parsePlatformProbe(output: string): PlatformInfo {
  const map = new Map<string, string>();
  for (const line of output.split("\n")) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    map.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  const on = (k: string) => map.get(k) === "1";

  // Prefer dnf over yum when both exist (dnf is the modern front-end).
  let pkg: PackageManager = null;
  if (on("apt")) pkg = "apt";
  else if (on("dnf")) pkg = "dnf";
  else if (on("yum")) pkg = "yum";
  else if (on("pacman")) pkg = "pacman";

  const os = map.get("os");
  return {
    hasSystemd: on("systemd"),
    pkg,
    hasCertbot: on("certbot"),
    hasAcmeSh: on("acmesh"),
    hasDocker: on("docker"),
    osPrettyName: os && os.length > 0 ? os : null,
  };
}

export async function detectPlatform(client: Client): Promise<PlatformInfo> {
  const { stdout } = await execCommand(client, PLATFORM_PROBE_COMMAND, 15000);
  return parsePlatformProbe(stdout);
}

export type HostPlatform = "darwin" | "linux" | "windows" | "other";

// Windows OpenSSH's default shell is usually cmd.exe (occasionally
// PowerShell), so scripts are sent base64-encoded via -EncodedCommand -
// that avoids every cmd.exe quoting/escaping pitfall entirely, since the
// argument ends up being plain alphanumeric text with no shell metacharacters.
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function execPowerShell(
  client: Client,
  script: string,
  timeoutMs = 30000,
): Promise<ExecResult> {
  const encoded = encodePowerShellCommand(script);
  return execCommand(
    client,
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    timeoutMs,
  );
}

export async function detectHostPlatform(
  client: Client,
): Promise<HostPlatform> {
  try {
    const { stdout, code } = await execCommand(client, "uname -s", 10000);
    const kernel = stdout.trim().toLowerCase();
    if (kernel === "darwin") return "darwin";
    if (kernel === "linux") return "linux";
    if (code === 0 && kernel) return "other";
  } catch {
    // expected on hosts with no POSIX shell (e.g. Windows via cmd.exe)
  }

  try {
    const { stdout } = await execPowerShell(client, "'WIN_OK'", 10000);
    if (stdout.includes("WIN_OK")) return "windows";
  } catch {
    // expected on hosts with no PowerShell available
  }

  return "other";
}

export interface UpgradablePackage {
  name: string;
  currentVersion?: string;
  newVersion?: string;
}

export function buildListUpgradableCommand(pkg: PackageManager): string | null {
  switch (pkg) {
    case "apt":
      return "apt list --upgradable 2>/dev/null | tail -n +2";
    case "dnf":
      return "dnf -q check-update 2>/dev/null || true";
    case "yum":
      return "yum -q check-update 2>/dev/null || true";
    case "pacman":
      return "pacman -Qu 2>/dev/null || true";
    default:
      return null;
  }
}

export function parseUpgradable(
  pkg: PackageManager,
  output: string,
): UpgradablePackage[] {
  const out: UpgradablePackage[] = [];
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (pkg === "apt") {
    for (const line of lines) {
      // name/suite newver arch [upgradable from: oldver]
      const m = line.match(
        /^([^/\s]+)\/\S+\s+(\S+)\s+\S+(?:\s+\[upgradable from:\s+(\S+)\])?/,
      );
      if (m) out.push({ name: m[1], newVersion: m[2], currentVersion: m[3] });
    }
  } else if (pkg === "dnf" || pkg === "yum") {
    for (const line of lines) {
      if (/^(Last metadata|Obsoleting|Security:)/i.test(line)) continue;
      const m = line.match(/^(\S+)\s+(\S+)\s+\S+$/);
      if (m && m[1].includes(".")) out.push({ name: m[1], newVersion: m[2] });
    }
  } else if (pkg === "pacman") {
    for (const line of lines) {
      const m = line.match(/^(\S+)\s+(\S+)\s+->\s+(\S+)$/);
      if (m) out.push({ name: m[1], currentVersion: m[2], newVersion: m[3] });
    }
  }
  return out;
}

export type PackageAction = "upgrade-all" | "install" | "upgrade";

export function buildPackageActionCommand(
  pkg: PackageManager,
  action: PackageAction,
  name?: string,
): string | null {
  const target = name ? ` ${name}` : "";
  switch (pkg) {
    case "apt":
      if (action === "upgrade-all")
        return "DEBIAN_FRONTEND=noninteractive apt-get -y upgrade";
      return `DEBIAN_FRONTEND=noninteractive apt-get -y install${target}`;
    case "dnf":
      return action === "upgrade-all"
        ? "dnf -y upgrade"
        : `dnf -y install${target}`;
    case "yum":
      return action === "upgrade-all"
        ? "yum -y update"
        : `yum -y install${target}`;
    case "pacman":
      return action === "upgrade-all"
        ? "pacman -Syu --noconfirm"
        : `pacman -S --noconfirm${target}`;
    default:
      return null;
  }
}

export function buildPackageRemoveCommand(
  pkg: PackageManager,
  name: string,
): string | null {
  switch (pkg) {
    case "apt":
      return `DEBIAN_FRONTEND=noninteractive apt-get -y remove ${name}`;
    case "dnf":
      return `dnf -y remove ${name}`;
    case "yum":
      return `yum -y remove ${name}`;
    case "pacman":
      return `pacman -R --noconfirm ${name}`;
    default:
      return null;
  }
}

const PACKAGE_RE = /^[A-Za-z0-9][A-Za-z0-9.+_-]*$/;

export function isValidPackageName(pkg: unknown): pkg is string {
  return typeof pkg === "string" && pkg.length <= 128 && PACKAGE_RE.test(pkg);
}

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
 * fails. Matched only against sudo's own stderr (never command output), so a
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
 * Marker printed only after sudo has successfully authenticated and started
 * the inner shell. Its presence on stdout is the authoritative "elevation
 * worked" signal; its absence (together with sudo stderr) means auth failed.
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
 * marker is echoed by the inner shell once sudo authenticates, letting us
 * tell a genuine auth failure from command output that merely contains scary
 * words.
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
 * Run a command on a client, elevating with the host's stored sudo password
 * only when needed (or when forced). Throws a typed `ElevationError` when
 * elevation is required but unavailable/incorrect.
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
    // No marker and no recognizable sudo error: treat as a generic failure
    // but keep the original output so the caller can surface it.
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
