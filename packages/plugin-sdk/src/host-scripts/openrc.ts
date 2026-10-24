/** OpenRC scripts, with states mapped onto the words systemd uses. */
import { isOpenRcName, type UnitAction, type UnitSummary } from "./systemd.js";
import { HostScriptError, shellQuote as q } from "./text.js";

export const OPENRC_LIST_SCRIPT = `
rc-status --servicelist 2>/dev/null
echo "@@TERMIX_RUNLEVELS@@"
rc-update show -v 2>/dev/null
exit 0
`;

function activeOf(state: string): { active: string; sub: string } {
  switch (state) {
    case "started":
      return { active: "active", sub: "running" };
    case "crashed":
      return { active: "failed", sub: "crashed" };
    case "starting":
      return { active: "activating", sub: "starting" };
    case "stopping":
      return { active: "deactivating", sub: "stopping" };
    case "inactive":
    case "hotplugged":
      return { active: "inactive", sub: state };
    default:
      return { active: "inactive", sub: state || "stopped" };
  }
}

export function parseOpenRcList(output: string): UnitSummary[] {
  const [list = "", levels = ""] = output.split("@@TERMIX_RUNLEVELS@@");
  const units = new Map<string, UnitSummary>();
  for (const line of list.split("\n")) {
    const match = /^\s*(\S+)\s+\[\s*([a-z ]+?)\s*\]/.exec(line);
    if (!match) continue;
    const { active, sub } = activeOf(match[2]);
    units.set(match[1], {
      name: match[1],
      type: "service",
      load: "loaded",
      active,
      sub,
      description: "",
      fileState: "disabled",
      preset: "",
    });
  }
  for (const line of levels.split("\n")) {
    const match = /^\s*(\S+)\s*\|\s*(.*)$/.exec(line);
    if (!match) continue;
    const runlevels = match[2].trim();
    const known = units.get(match[1]) ?? {
      name: match[1],
      type: "service",
      load: "loaded",
      active: "inactive",
      sub: "stopped",
      description: "",
      fileState: "disabled",
      preset: "",
    };
    known.fileState = runlevels ? "enabled" : "disabled";
    known.description = runlevels ? `Runlevels: ${runlevels}` : "";
    units.set(match[1], known);
  }
  return [...units.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function requireName(name: string): string {
  if (!isOpenRcName(name))
    throw new HostScriptError("That is not a valid service name");
  return name;
}

export function openRcActionScript(name: string, action: UnitAction): string {
  const s = q(requireName(name));
  switch (action) {
    case "start":
    case "stop":
    case "restart":
      return `rc-service ${s} ${action} 2>&1 || { echo "SCRIPT_ERR:rc-service ${action} failed"; exit 1; }\n`;
    case "enable":
      return `rc-update add ${s} default 2>&1 || { echo "SCRIPT_ERR:rc-update add failed"; exit 1; }\n`;
    case "disable":
      return `rc-update del ${s} 2>&1 || { echo "SCRIPT_ERR:rc-update del failed"; exit 1; }\n`;
    default:
      throw new HostScriptError("OpenRC can't do that", 400);
  }
}

export function openRcStatusScript(name: string): string {
  const s = q(requireName(name));
  return `rc-service ${s} status 2>&1; rc-update show -v 2>/dev/null | grep -E '^ *'${s}' *\\|'; exit 0\n`;
}
