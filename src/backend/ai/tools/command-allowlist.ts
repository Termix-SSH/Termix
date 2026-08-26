/**
 * Which commands the assistant may run without a per-command approval click,
 * for users who opted into read-only execution.
 *
 * The check parses the command into arguments and matches the resolved binary
 * against the allowlist. Substring matching would be trivially defeated
 * ("df; rm -rf /" contains "df"), so any shell metacharacter that could chain,
 * redirect or substitute a second command rejects the whole string outright.
 */

export const READ_ONLY_COMMANDS = new Set([
  "df",
  "du",
  "free",
  "uptime",
  "uname",
  "whoami",
  "hostname",
  "id",
  "ps",
  "top",
  "systemctl",
  "journalctl",
  "docker",
  "ip",
  "ss",
  "netstat",
  "lsblk",
  "cat",
  "ls",
  "stat",
  "which",
  "date",
  "lscpu",
  "vmstat",
  "iostat",
]);

/** Characters that let one command become several. */
const SHELL_METACHARACTERS = /[;&|`$><\n\r\\]/;

/** Subcommands that are safe for otherwise-powerful binaries. */
const SUBCOMMAND_ALLOWLIST: Record<string, Set<string>> = {
  systemctl: new Set([
    "status",
    "list-units",
    "list-unit-files",
    "is-active",
    "is-enabled",
    "show",
  ]),
  docker: new Set([
    "ps",
    "stats",
    "images",
    "logs",
    "inspect",
    "version",
    "info",
  ]),
  ip: new Set(["a", "addr", "link", "route", "neigh"]),
};

/** Paths `cat` may read. Anything else could disclose credentials. */
const CAT_ALLOWED_PREFIXES = ["/proc/", "/sys/", "/etc/os-release"];

/**
 * Per-process entries under /proc that are doors out of /proc rather than
 * files: `/proc/self/root` is a symlink to `/`, so `/proc/self/root/etc/shadow`
 * satisfies the "/proc/" prefix while reading anything on the host. `environ`
 * and `cmdline` leak the secrets a process was started with, `mem` is its
 * address space, and `task` nests another copy of all of them.
 */
const PROC_PROCESS_ENTRY_DENYLIST = new Set([
  "root",
  "cwd",
  "exe",
  "fd",
  "fdinfo",
  "map_files",
  "mem",
  "environ",
  "cmdline",
  "task",
]);

function isSafeReadPath(target: string): boolean {
  if (!target.startsWith("/")) return false;

  const segments = target.split("/").filter(Boolean);
  // "/proc/../etc/shadow" passes a naive prefix check.
  if (segments.includes("..")) return false;

  if (segments[0] !== "proc" || segments.length < 3) return true;

  const isProcessDir = /^(\d+|self|thread-self)$/.test(segments[1]);
  return !isProcessDir || !PROC_PROCESS_ENTRY_DENYLIST.has(segments[2]);
}

export interface CommandCheck {
  allowed: boolean;
  reason?: string;
}

export function isReadOnlyCommand(raw: string): CommandCheck {
  const command = raw.trim();
  if (!command) return { allowed: false, reason: "Empty command" };

  if (SHELL_METACHARACTERS.test(command)) {
    return {
      allowed: false,
      reason: "Command chaining, redirection and substitution are not allowed",
    };
  }

  const parts = command.split(/\s+/).filter(Boolean);
  if (!parts.length) return { allowed: false, reason: "Empty command" };

  // Reject env-prefixed and privilege-escalating forms outright.
  const head = parts[0];
  if (head === "sudo" || head === "su" || head === "doas" || head === "env") {
    return { allowed: false, reason: `${head} is not allowed` };
  }

  // A path like /usr/bin/df resolves to its basename.
  const binary = head.includes("/")
    ? head.slice(head.lastIndexOf("/") + 1)
    : head;

  if (!READ_ONLY_COMMANDS.has(binary)) {
    return {
      allowed: false,
      reason: `${binary} is not on the read-only allowlist`,
    };
  }

  const allowedSubcommands = SUBCOMMAND_ALLOWLIST[binary];
  if (allowedSubcommands) {
    const subcommand = parts.slice(1).find((part) => !part.startsWith("-"));
    if (!subcommand || !allowedSubcommands.has(subcommand)) {
      return {
        allowed: false,
        reason:
          `${binary} ${subcommand ?? ""}`.trim() +
          " is not on the read-only allowlist",
      };
    }
  }

  if (binary === "cat") {
    const targets = parts.slice(1).filter((part) => !part.startsWith("-"));
    if (!targets.length) {
      return { allowed: false, reason: "cat needs a file path" };
    }
    for (const target of targets) {
      const permitted =
        isSafeReadPath(target) &&
        CAT_ALLOWED_PREFIXES.some((prefix) =>
          prefix.endsWith("/") ? target.startsWith(prefix) : target === prefix,
        );
      if (!permitted) {
        return {
          allowed: false,
          reason: `cat is limited to ${CAT_ALLOWED_PREFIXES.join(", ")}`,
        };
      }
    }
  }

  return { allowed: true };
}
