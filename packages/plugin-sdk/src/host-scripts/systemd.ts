/**
 * systemd unit scripts and parsers, plus init system detection.
 * Every script is meant for `scriptShell()`, sent on stdin.
 */
import { HostScriptError, parseKeys, shellQuote as q } from "./text.js";

export const UNIT_TYPES = [
  "service",
  "socket",
  "timer",
  "target",
  "mount",
  "automount",
  "path",
  "swap",
  "slice",
  "scope",
  "device",
] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

// Backslash is allowed for escaped names like dev-disk-by\x2duuid.
const UNIT_RE = new RegExp(
  `^[A-Za-z0-9_][A-Za-z0-9:_.@\\\\-]{0,250}\\.(${UNIT_TYPES.join("|")})$`,
);
const OPENRC_RE = /^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,127}$/;

export function isUnit(name: unknown): name is string {
  return typeof name === "string" && UNIT_RE.test(name);
}

export function unitType(name: string): UnitType {
  return name.slice(name.lastIndexOf(".") + 1) as UnitType;
}

/** Units a file may be written for. Templates and device style names are out. */
export function isWritableUnitName(name: string): boolean {
  return (
    isUnit(name) &&
    !name.includes("\\") &&
    ["service", "socket", "timer", "target", "path", "mount"].includes(
      unitType(name),
    )
  );
}

export function isOpenRcName(name: unknown): name is string {
  return typeof name === "string" && OPENRC_RE.test(name);
}

export function requireUnit(name: unknown): string {
  if (!isUnit(name)) throw new HostScriptError("That is not a valid unit name");
  return name;
}

export type InitSystem = "systemd" | "openrc" | "none";

/** A unit name or, on OpenRC, a service name. */
export function requireService(name: unknown, init: string): string {
  if (init === "openrc") {
    if (!isOpenRcName(name))
      throw new HostScriptError("That is not a valid service name");
    return name;
  }
  return requireUnit(name);
}

export interface UnitSummary {
  name: string;
  type: string;
  load: string;
  active: string;
  sub: string;
  description: string;
  /** enabled, disabled, static, masked and so on. Empty when unknown. */
  fileState: string;
  preset: string;
}

export interface UnitDetail {
  name: string;
  props: Record<string, string>;
  status: string;
}

export interface TimerView {
  name: string;
  description: string;
  active: string;
  fileState: string;
  /** Unix ms, or null when not set. */
  next: number | null;
  last: number | null;
  activates: string;
  schedule: string[];
}

export const UNIT_ACTIONS = [
  "start",
  "stop",
  "restart",
  "reload",
  "enable",
  "disable",
  "enable-now",
  "disable-now",
  "mask",
  "unmask",
  "reset-failed",
  "revert",
] as const;
export type UnitAction = (typeof UNIT_ACTIONS)[number];

/** Actions OpenRC can do. */
export const OPENRC_ACTIONS: readonly UnitAction[] = [
  "start",
  "stop",
  "restart",
  "enable",
  "disable",
];

export const DETECT_SCRIPT = `
INIT=none
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then INIT=systemd
elif command -v rc-service >/dev/null 2>&1; then INIT=openrc; fi
echo "init=$INIT"
if [ "$INIT" = systemd ]; then echo "version=$(systemctl --version 2>/dev/null | head -n1 | awk '{print $2}')"; fi
if [ "$INIT" = openrc ]; then echo "version=$(openrc --version 2>/dev/null | head -n1 | awk '{print $NF}')"; fi
echo "os=$( . /etc/os-release 2>/dev/null; echo "$PRETTY_NAME")"
echo "hostname=$(hostname 2>/dev/null || cat /etc/hostname 2>/dev/null)"
echo "uid=$(id -u)"
if command -v journalctl >/dev/null 2>&1; then echo "journal=1"; fi
if [ "$INIT" = systemd ]; then echo "failed=$(systemctl list-units --state=failed --plain --no-legend --no-pager 2>/dev/null | wc -l)"; fi
if [ "$INIT" = openrc ]; then echo "failed=$(rc-status --crashed 2>/dev/null | wc -l)"; fi
exit 0
`;

export interface Detected {
  init: InitSystem;
  version: string;
  os: string;
  hostname: string;
  root: boolean;
  journal: boolean;
  failed: number;
}

export function parseDetect(output: string): Detected {
  const keys = parseKeys(output);
  const init =
    keys.init === "systemd" || keys.init === "openrc" ? keys.init : "none";
  return {
    init,
    version: keys.version ?? "",
    os: keys.os ?? "",
    hostname: keys.hostname ?? "",
    root: keys.uid === "0",
    journal: keys.journal === "1",
    failed: Number(keys.failed) || 0,
  };
}

/** Types the list can show. */
export const LIST_TYPES = [
  "service",
  "socket",
  "timer",
  "target",
  "path",
  "mount",
] as const;
export type ListType = (typeof LIST_TYPES)[number] | "all";

export function listUnitsScript(type: ListType): string {
  const types = type === "all" ? LIST_TYPES.join(",") : type;
  if (type !== "all" && !LIST_TYPES.includes(type))
    throw new HostScriptError("Unknown unit type");
  return `
systemctl list-units --all --plain --no-legend --no-pager --full --type=${types} 2>/dev/null
echo "@@TERMIX_FILES@@"
systemctl list-unit-files --plain --no-legend --no-pager --full --type=${types} 2>/dev/null
exit 0
`;
}

/** Merges list-units and list-unit-files. Template units are left out. */
export function parseUnitList(output: string): UnitSummary[] {
  const [loaded = "", files = ""] = output.split("@@TERMIX_FILES@@");
  const units = new Map<string, UnitSummary>();
  for (const raw of loaded.split("\n")) {
    const line = raw.replace(/^[●*\s]+/, "").trimEnd();
    if (!line) continue;
    const match = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, name, load, active, sub, description] = match;
    if (!name.includes(".") || name.includes("@.")) continue;
    units.set(name, {
      name,
      type: unitType(name),
      load,
      active,
      sub,
      description: description.trim(),
      fileState: "",
      preset: "",
    });
  }
  for (const raw of files.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [name, state = "", preset = ""] = line.split(/\s+/);
    if (!name || !name.includes(".") || name.includes("@.")) continue;
    const known = units.get(name);
    const cleanPreset = preset === "-" ? "" : preset;
    if (known) {
      known.fileState = state;
      known.preset = cleanPreset;
    } else {
      units.set(name, {
        name,
        type: unitType(name),
        load: state === "masked" ? "masked" : "unloaded",
        active: "inactive",
        sub: "dead",
        description: "",
        fileState: state,
        preset: cleanPreset,
      });
    }
  }
  return [...units.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const DETAIL_PROPS = [
  "Id",
  "Description",
  "LoadState",
  "ActiveState",
  "SubState",
  "UnitFileState",
  "UnitFilePreset",
  "Result",
  "MainPID",
  "ExecMainStartTimestamp",
  "ActiveEnterTimestamp",
  "InactiveEnterTimestamp",
  "MemoryCurrent",
  "MemoryPeak",
  "CPUUsageNSec",
  "TasksCurrent",
  "NRestarts",
  "FragmentPath",
  "DropInPaths",
  "Requires",
  "Wants",
  "After",
  "WantedBy",
  "TriggeredBy",
  "Triggers",
  "User",
  "Group",
  "Restart",
  "Type",
  "ExecStart",
  "CanStart",
  "CanStop",
  "CanReload",
] as const;

export function detailScript(unit: string): string {
  const props = DETAIL_PROPS.map((p) => `-p ${p}`).join(" ");
  return `
systemctl show --no-pager ${props} -- ${q(requireUnit(unit))}
echo "@@TERMIX_STATUS@@"
systemctl status --no-pager --full -n 0 -- ${q(unit)} 2>&1
exit 0
`;
}

export function parseDetail(unit: string, output: string): UnitDetail {
  const [props = "", status = ""] = output.split("@@TERMIX_STATUS@@");
  return { name: unit, props: parseKeys(props), status: status.trim() };
}

const VERBS: Record<UnitAction, string> = {
  start: "start",
  stop: "stop",
  restart: "restart",
  reload: "reload",
  enable: "enable",
  disable: "disable",
  "enable-now": "enable --now",
  "disable-now": "disable --now",
  mask: "mask",
  unmask: "unmask",
  "reset-failed": "reset-failed",
  revert: "revert",
};

/** The systemctl call for an action. Prints `state=` after it. */
export function actionScript(unit: string, action: UnitAction): string {
  const verb = VERBS[action];
  if (!verb) throw new HostScriptError("Unknown action");
  const u = q(requireUnit(unit));
  return `
systemctl ${verb} -- ${u} 2>&1 || { echo "SCRIPT_ERR:systemctl ${verb} failed"; exit 1; }
echo "state=$(systemctl is-active -- ${u} 2>/dev/null)"
`;
}

/** Times systemctl prints under TZ=UTC, like "Thu 2026-10-22 02:03:51 UTC". */
export function parseSystemdTime(value: string | undefined): number | null {
  if (!value) return null;
  const match = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

export const TIMERS_SCRIPT = `
UNITS=$( { systemctl list-units --all --type=timer --plain --no-legend --no-pager --full 2>/dev/null | awk '{print $1}'; systemctl list-unit-files --type=timer --plain --no-legend --no-pager --full 2>/dev/null | awk '{print $1}'; } | grep '\\.timer$' | grep -v '@\\.timer$' | sort -u)
[ -n "$UNITS" ] || exit 0
systemctl show --no-pager -p Id -p Description -p ActiveState -p UnitFileState -p NextElapseUSecRealtime -p LastTriggerUSec -p Triggers -p TimersCalendar -p TimersMonotonic -- $UNITS
exit 0
`;

/** Reads systemctl show output for many units, split by blank lines. */
export function parseShowBlocks(output: string): Array<Record<string, string>> {
  const blocks: Array<Record<string, string>> = [];
  for (const block of output.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((line) => line.includes("="));
    if (!lines.length) continue;
    // A unit can have several TimersCalendar lines; keep all of them.
    const keys: Record<string, string> = {};
    for (const line of lines) {
      const eq = line.indexOf("=");
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      keys[key] = key in keys ? `${keys[key]}\n${value}` : value;
    }
    blocks.push(keys);
  }
  return blocks;
}

function schedules(value: string | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const line of value.split("\n")) {
    const match = /\{\s*(\w+)=(.+?)\s*;/.exec(line);
    if (match) out.push(`${match[1]}=${match[2]}`);
  }
  return out;
}

export function parseTimers(output: string): TimerView[] {
  return parseShowBlocks(output)
    .filter((keys) => keys.Id?.endsWith(".timer"))
    .map((keys) => ({
      name: keys.Id,
      description: keys.Description ?? "",
      active: keys.ActiveState ?? "",
      fileState: keys.UnitFileState ?? "",
      next: parseSystemdTime(keys.NextElapseUSecRealtime),
      last: parseSystemdTime(keys.LastTriggerUSec),
      activates: (keys.Triggers ?? "").split(/\s+/)[0] ?? "",
      schedule: [
        ...schedules(keys.TimersCalendar),
        ...schedules(keys.TimersMonotonic),
      ],
    }))
    .sort((a, b) => (a.next ?? Infinity) - (b.next ?? Infinity));
}

/** One line per unit from systemctl is-active, in the order asked. */
export function isActiveScript(units: string[]): string {
  return `systemctl is-active -- ${units.map((u) => q(requireUnit(u))).join(" ")} 2>/dev/null; exit 0\n`;
}

export function parseIsActive(
  units: string[],
  output: string,
): Map<string, string> {
  const lines = output.split("\n").map((line) => line.trim());
  const out = new Map<string, string>();
  units.forEach((unit, i) => out.set(unit, lines[i] || "unknown"));
  return out;
}
