import type { Client } from "ssh2";
import { execCommand } from "../widgets/common-utils.js";

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
 * Single probe that reports which tooling is available. Each line is
 * "key=value" so the parser is trivial and order-independent.
 */
export const PLATFORM_PROBE_COMMAND = [
  "echo systemd=$(command -v systemctl >/dev/null 2>&1 && echo 1 || echo 0)",
  "echo apt=$(command -v apt-get >/dev/null 2>&1 && echo 1 || echo 0)",
  "echo dnf=$(command -v dnf >/dev/null 2>&1 && echo 1 || echo 0)",
  "echo yum=$(command -v yum >/dev/null 2>&1 && echo 1 || echo 0)",
  "echo pacman=$(command -v pacman >/dev/null 2>&1 && echo 1 || echo 0)",
  "echo certbot=$(command -v certbot >/dev/null 2>&1 && echo 1 || echo 0)",
  'echo acmesh=$( { command -v acme.sh >/dev/null 2>&1 || [ -x "$HOME/.acme.sh/acme.sh" ]; } && echo 1 || echo 0)',
  "echo docker=$(command -v docker >/dev/null 2>&1 && echo 1 || echo 0)",
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
