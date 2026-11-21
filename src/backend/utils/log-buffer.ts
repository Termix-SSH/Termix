/**
 * Keeps recent server log lines in memory so admins can read them in the UI
 * and attach them to a diagnostics report. Lines are masked on the way in.
 * The first lines since start are kept apart, so a long running server still
 * shows how it booted.
 */
import { format } from "util";

export type BufferedLevel = "debug" | "info" | "warn" | "error" | "success";

export interface BufferedLogLine {
  seq: number;
  at: string;
  level: BufferedLevel;
  service: string;
  pluginId?: string;
  operation?: string;
  text: string;
}

const BOOT_LINES = 400;
const RECENT_LINES = 4000;
const RECENT_BYTES = 2 * 1024 * 1024;
const MAX_LINE = 4000;

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

let seq = 0;
let boot: BufferedLogLine[] = [];
let recent: BufferedLogLine[] = [];
let recentBytes = 0;
let mask: (text: string) => string = (text) => text;

/** Set by the logger so console lines are masked like its own. */
export function setLogBufferMask(fn: (text: string) => string): void {
  mask = fn;
}

function pluginFrom(text: string, operation?: string): string | undefined {
  if (operation?.startsWith("plugin:")) return operation.slice(7);
  const match = /(?:^|\] )Plugin ([a-z0-9][a-z0-9-]*):/.exec(text);
  return match?.[1];
}

export function recordLogLine(line: {
  level: BufferedLevel;
  service: string;
  text: string;
  pluginId?: string;
  operation?: string;
}): void {
  let text = mask(line.text.replace(ANSI, ""));
  if (text.length > MAX_LINE) text = `${text.slice(0, MAX_LINE)}...(cut)`;
  const entry: BufferedLogLine = {
    seq: ++seq,
    at: new Date().toISOString(),
    level: line.level,
    service: line.service,
    text,
  };
  const pluginId = line.pluginId ?? pluginFrom(text, line.operation);
  if (pluginId) entry.pluginId = pluginId;
  if (line.operation) entry.operation = line.operation;
  if (boot.length < BOOT_LINES) {
    boot.push(entry);
    return;
  }
  recent.push(entry);
  recentBytes += text.length;
  while (
    recent.length > RECENT_LINES ||
    (recentBytes > RECENT_BYTES && recent.length > 1)
  ) {
    recentBytes -= recent.shift()!.text.length;
  }
}

export interface LogQuery {
  after?: number;
  levels?: BufferedLevel[];
  pluginId?: string;
  limit?: number;
}

function matches(line: BufferedLogLine, query: LogQuery): boolean {
  if (query.after !== undefined && line.seq <= query.after) return false;
  if (query.levels && !query.levels.includes(line.level)) return false;
  if (query.pluginId && line.pluginId !== query.pluginId) return false;
  return true;
}

/** Boot lines and recent lines, oldest first. */
export function readLogLines(query: LogQuery = {}): {
  boot: BufferedLogLine[];
  recent: BufferedLogLine[];
  latest: number;
  droppedBefore: number | null;
} {
  const limit = query.limit ?? RECENT_LINES;
  const bootOut = boot.filter((line) => matches(line, query));
  const recentOut = recent.filter((line) => matches(line, query));
  const first = recent[0]?.seq;
  return {
    boot: bootOut,
    recent: recentOut.slice(-limit),
    latest: seq,
    droppedBefore:
      first !== undefined && first > BOOT_LINES + 1 ? first - 1 : null,
  };
}

let consoleDepth = 0;

/** Runs a console call that is already recorded, so the wrap skips it. */
export function withoutCapture(fn: () => void): void {
  consoleDepth++;
  try {
    fn();
  } finally {
    consoleDepth--;
  }
}

const CONSOLE_LEVELS: [keyof Console, BufferedLevel][] = [
  ["log", "info"],
  ["info", "info"],
  ["warn", "warn"],
  ["error", "error"],
  ["debug", "debug"],
];

let restoreConsole: (() => void) | null = null;

/**
 * Records console output that does not come through the logger, like
 * libraries and early boot code. Calls go through to the real console.
 */
export function installConsoleCapture(): () => void {
  if (restoreConsole) return restoreConsole;
  const saved = new Map<string, unknown>();
  for (const [name, level] of CONSOLE_LEVELS) {
    const original = console[name] as (...args: unknown[]) => void;
    saved.set(name, original);
    (console as unknown as Record<string, unknown>)[name] = (
      ...args: unknown[]
    ) => {
      if (consoleDepth === 0) {
        consoleDepth++;
        try {
          recordLogLine({ level, service: "CONSOLE", text: format(...args) });
        } catch {
          // A broken record must never break logging.
        } finally {
          consoleDepth--;
        }
      }
      original.apply(console, args);
    };
  }
  restoreConsole = () => {
    for (const [name, original] of saved) {
      (console as unknown as Record<string, unknown>)[name] = original;
    }
    restoreConsole = null;
  };
  return restoreConsole;
}

/** For tests. */
export function resetLogBuffer(): void {
  seq = 0;
  boot = [];
  recent = [];
  recentBytes = 0;
}
