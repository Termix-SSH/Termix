/**
 * How a script reaches the host: the command line runs a shell that reads
 * the script from stdin (`bash -s`), so names and values in a script are
 * never parsed out of argv.
 */
import { shellQuote, toBase64 } from "./text.js";

// systemctl and friends often live in sbin, which a normal login skips.
// TZ=UTC so tools print every time in UTC, which parses the same anywhere.
const ENV = "SYSTEMD_COLORS=0 SYSTEMD_PAGER=cat LC_ALL=C TZ=UTC";

/** Puts sbin on PATH and sets a plain, UTC environment. */
export const SCRIPT_PRELUDE = `export PATH="$PATH:/usr/sbin:/sbin:/usr/local/sbin"; export ${ENV}; `;
const SUDO = `sudo -n env PATH="$PATH" ${ENV}`;

/**
 * - `plain`: the login user.
 * - `auto`: root when it can be had without a password, else the login user.
 * - `root`: root or passwordless sudo, fails on anything else.
 * - `root-only`: root logins only, for hosts where sudo is turned off.
 */
export type ScriptShellMode = "plain" | "auto" | "root" | "root-only";

const ERR = "SCRIPT_ERR:";

/** The command line that runs a script sent on stdin. */
export function scriptShell(mode: ScriptShellMode): string {
  switch (mode) {
    case "plain":
      return `${SCRIPT_PRELUDE}exec bash -s`;
    case "auto":
      return `${SCRIPT_PRELUDE}if [ "$(id -u)" = "0" ]; then exec bash -s; elif sudo -n true 2>/dev/null; then exec ${SUDO} bash -s; else exec bash -s; fi`;
    case "root":
      return `${SCRIPT_PRELUDE}if [ "$(id -u)" = "0" ]; then exec bash -s; else exec ${SUDO} bash -s; fi`;
    case "root-only":
      return `${SCRIPT_PRELUDE}if [ "$(id -u)" = "0" ]; then exec bash -s; else echo "${ERR}This needs root, or turn on Use sudo for this host"; exit 1; fi`;
  }
}

/**
 * Runs a script as root with a sudo password. The command is `plain`; all of
 * the returned stdin goes to the host. The password is read by the first
 * line into a shell variable and piped to `sudo -S`, so it is never in argv,
 * never in the environment and never run as a command. Root logins and
 * passwordless sudo skip the password. The script itself travels as base64.
 */
export function passwordSudoScript(
  script: string,
  password: string,
): { command: string; stdin: string } {
  if (/[\r\n\0]/.test(password)) {
    throw new Error("A sudo password can't contain a line break");
  }
  const run = `bash -c "$TERMIX_S"`;
  const stdin = `IFS= read -r TERMIX_PW
${password}
TERMIX_S=$(printf '%s' ${shellQuote(toBase64(script))} | base64 -d)
if [ "$(id -u)" = "0" ]; then unset TERMIX_PW; exec ${run}
elif sudo -n true 2>/dev/null; then unset TERMIX_PW; exec ${SUDO} ${run}
else P=$TERMIX_PW; unset TERMIX_PW; printf '%s\\n' "$P" | sudo -k -S -p '' env PATH="$PATH" ${ENV} ${run}; exit $?
fi
`;
  return { command: scriptShell("plain"), stdin };
}

/** sudo asked for a password or a terminal it did not get. */
export const SUDO_REFUSED_RE =
  /password is required|a terminal is required|no tty present/i;
/** sudo got a password and it was wrong. */
export const SUDO_WRONG_RE =
  /incorrect password|sorry, try again|no password was provided/i;
/** The user may not use sudo at all. */
export const NOT_SUDOER_RE =
  /is not in the sudoers file|not allowed to run sudo/i;

/**
 * Scripts print `SCRIPT_ERR:` lines (or the older `SERVICES_ERR:`) before a
 * non zero exit to explain a failure.
 */
export function scriptError(stdout: string): string {
  return stdout
    .split("\n")
    .map((line) => {
      if (line.startsWith(ERR)) return line.slice(ERR.length);
      if (line.startsWith("SERVICES_ERR:")) return line.slice(13);
      return null;
    })
    .filter((line): line is string => line !== null)
    .join("\n")
    .trim();
}

/** A line a script prints to explain why it stops. */
export function errLine(message: string): string {
  return `echo ${shellQuote(ERR + message)}`;
}

/**
 * Runs a long command in the background and stops it once stdin closes,
 * which happens when the SSH channel ends. A pty can't be trusted for this:
 * sudo keeps its own and the command would outlive the viewer.
 */
export function watchdog(command: string): string {
  return `${command} &
P=$!
trap 'kill $P 2>/dev/null' EXIT
cat >/dev/null
`;
}

/** The wrapper a streamed command runs in, as one shell command line. */
export function streamCommand(script: string, sudo: boolean): string {
  const quoted = shellQuote(`${SCRIPT_PRELUDE}${script}`);
  return sudo
    ? `if [ "$(id -u)" = "0" ]; then exec bash -c ${quoted}; elif sudo -n true 2>/dev/null; then exec ${SUDO} bash -c ${quoted}; else exec bash -c ${quoted}; fi`
    : `exec bash -c ${quoted}`;
}
