/** journalctl scripts and parsers. */
import { isUnit } from "./systemd.js";
import { HostScriptError, shellQuote as q, utf8Decode } from "./text.js";

export const MAX_JOURNAL_LINES = 5000;
const FIELDS = "MESSAGE,PRIORITY,_SYSTEMD_UNIT,SYSLOG_IDENTIFIER,_PID,_COMM";

export interface JournalQuery {
  units: string[];
  priority?: number;
  since?: string;
  until?: string;
  boot?: string;
  grep?: string;
  lines: number;
  kernel: boolean;
}

export interface JournalEntry {
  /** Unix ms. */
  time: number;
  priority: number;
  unit: string;
  ident: string;
  pid: string;
  message: string;
}

export interface BootView {
  offset: number;
  id: string;
  first: string;
  last: string;
}

const RELATIVE_RE = /^-\d{1,5}(s|m|min|h|d|w)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;
const WORDS = ["today", "yesterday", "now"];

export function isJournalTime(value: string): boolean {
  return (
    RELATIVE_RE.test(value) || DATE_RE.test(value) || WORDS.includes(value)
  );
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Reads journal filters from a query string. Anything odd throws a HostScriptError. */
export function parseJournalQuery(
  input: Record<string, unknown>,
): JournalQuery {
  const rawUnits = Array.isArray(input.unit) ? input.unit : [input.unit];
  const units = rawUnits.map(str).filter(Boolean);
  for (const unit of units) {
    if (!isUnit(unit))
      throw new HostScriptError("That is not a valid unit name");
  }
  if (units.length > 20) throw new HostScriptError("Too many units");

  const query: JournalQuery = {
    units,
    lines: 300,
    kernel: input.kernel === "true" || input.kernel === true,
  };
  const priority = str(input.priority);
  if (priority) {
    const value = Number(priority);
    if (!Number.isInteger(value) || value < 0 || value > 7) {
      throw new HostScriptError("priority must be 0 to 7");
    }
    query.priority = value;
  }
  for (const key of ["since", "until"] as const) {
    const value = str(input[key]);
    if (!value) continue;
    if (!isJournalTime(value))
      throw new HostScriptError(`${key} is not a valid time`);
    query[key] = value;
  }
  const boot = str(input.boot);
  if (boot) {
    if (!/^(-?\d{1,4}|[0-9a-f]{32})$/.test(boot))
      throw new HostScriptError("boot is not valid");
    query.boot = boot;
  }
  const grep = typeof input.grep === "string" ? input.grep : "";
  if (grep) {
    if (grep.length > 200 || /[\r\n\0]/.test(grep)) {
      throw new HostScriptError("The search is too long");
    }
    query.grep = grep;
  }
  const lines = Number(str(input.lines) || 300);
  if (Number.isFinite(lines) && lines > 0) {
    query.lines = Math.min(MAX_JOURNAL_LINES, Math.round(lines));
  }
  return query;
}

/** journalctl arguments for a query, each one quoted. */
export function journalArgs(
  query: Omit<JournalQuery, "lines"> & { lines?: number },
  options: { follow?: boolean; useGrep?: boolean } = {},
): string {
  const args = ["journalctl", "--no-pager", "-q", "-o", "json"];
  args.push(`--output-fields=${FIELDS}`);
  if (options.follow) args.push("-f");
  if (query.lines) args.push("-n", String(Math.floor(query.lines)));
  for (const unit of query.units) {
    if (!isUnit(unit))
      throw new HostScriptError("That is not a valid unit name");
    args.push("-u", q(unit));
  }
  if (query.kernel) args.push("-k");
  if (query.priority !== undefined)
    args.push("-p", String(Math.floor(query.priority)));
  if (query.since) args.push("--since", q(query.since));
  if (query.until) args.push("--until", q(query.until));
  if (query.boot) args.push("-b", q(query.boot));
  if (query.grep && options.useGrep !== false) {
    args.push("--case-sensitive=false", "-g", q(query.grep));
  }
  return args.join(" ");
}

export function journalScript(query: JournalQuery): string {
  // Older journalctl builds have no -g. Then the search runs on our side instead.
  const noGrep = journalArgs(
    { ...query, lines: query.grep ? MAX_JOURNAL_LINES : query.lines },
    { useGrep: false },
  );
  return `
command -v journalctl >/dev/null 2>&1 || { echo "SCRIPT_ERR:This host has no journal"; exit 1; }
${journalArgs(query)} 2>/tmp/termix-journal.$$
RC=$?
if [ $RC -ne 0 ] && grep -qi "pattern" /tmp/termix-journal.$$; then
  rm -f /tmp/termix-journal.$$
  echo "@@TERMIX_NOGREP@@"
  ${noGrep}
  exit 0
fi
cat /tmp/termix-journal.$$ >&2; rm -f /tmp/termix-journal.$$
exit $RC
`;
}

function messageOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return utf8Decode(value.filter((n): n is number => typeof n === "number"));
  }
  return value == null ? "" : String(value);
}

/** One `journalctl -o json` line, or null when it is not an entry. */
export function parseEntry(line: string): JournalEntry | null {
  const text = line.trim();
  if (!text.startsWith("{")) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const micros = Number(raw.__REALTIME_TIMESTAMP);
  const priority = Number(raw.PRIORITY);
  return {
    time: Number.isFinite(micros) ? Math.floor(micros / 1000) : 0,
    priority: Number.isInteger(priority) ? priority : 6,
    unit: messageOf(raw._SYSTEMD_UNIT),
    ident: messageOf(raw.SYSLOG_IDENTIFIER ?? raw._COMM),
    pid: messageOf(raw._PID),
    message: messageOf(raw.MESSAGE),
  };
}

export function parseJournal(
  output: string,
  query: JournalQuery,
): JournalEntry[] {
  const fallback = output.includes("@@TERMIX_NOGREP@@");
  const body = fallback ? output.split("@@TERMIX_NOGREP@@")[1] : output;
  let entries = body
    .split("\n")
    .map(parseEntry)
    .filter((entry): entry is JournalEntry => entry !== null);
  if (fallback && query.grep) {
    const needle = query.grep.toLowerCase();
    entries = entries
      .filter((entry) => entry.message.toLowerCase().includes(needle))
      .slice(-query.lines);
  }
  return entries;
}

export const BOOTS_SCRIPT = `journalctl --list-boots --no-pager 2>/dev/null | tail -n 50; exit 0\n`;

export function parseBoots(output: string): BootView[] {
  const boots: BootView[] = [];
  for (const line of output.split("\n")) {
    const match =
      /^\s*(-?\d+)\s+([0-9a-f]{32})\s+(\w{3} \S+ \S+ \S+)\s*.?\s*(\w{3} \S+ \S+ \S+)?/.exec(
        line,
      );
    if (!match) continue;
    boots.push({
      offset: Number(match[1]),
      id: match[2],
      first: match[3],
      last: match[4] ?? "",
    });
  }
  return boots.reverse();
}

export const USAGE_SCRIPT = `journalctl --disk-usage 2>&1; exit 0\n`;

export function parseUsage(output: string): string {
  return /take up (\S+)/.exec(output)?.[1] ?? "";
}

const SIZE_RE = /^\d{1,6}(K|M|G)$/;
const AGE_RE = /^\d{1,4}(d|w|month|months|year|years)$/;

export function vacuumScript(body: Record<string, unknown>): string {
  const size = str(body.size);
  const time = str(body.time);
  if (!size && !time) throw new HostScriptError("Give a size or an age");
  if (size && !SIZE_RE.test(size))
    throw new HostScriptError("Size looks like 500M or 2G");
  if (time && !AGE_RE.test(time))
    throw new HostScriptError("Age looks like 7d or 4w");
  const flags = [
    size ? `--vacuum-size=${size}` : "",
    time ? `--vacuum-time=${time}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `journalctl ${flags} 2>&1 || { echo "SCRIPT_ERR:journalctl vacuum failed"; exit 1; }\n`;
}
