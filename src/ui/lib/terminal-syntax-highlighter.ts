const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightCyan: "\x1b[96m",
  bold: "\x1b[1m",
  underline: "\x1b[4m",
} as const;

export interface SyntaxHighlightOptions {
  logLevels?: boolean;
  paths?: boolean;
  timestamps?: boolean;
  ipAddresses?: boolean;
  urls?: boolean;
  numbers?: boolean;
}

interface HighlightPattern {
  name: string;
  regex: RegExp;
  ansiCode: string;
  priority: number;
  category: keyof SyntaxHighlightOptions;
}

interface MatchResult {
  start: number;
  end: number;
  ansiCode: string;
  priority: number;
  // capture group offset: some patterns capture a sub-group rather than whole match
  captureStart?: number;
  captureEnd?: number;
}

interface TextSegment {
  isAnsi: boolean;
  content: string;
  // the last active SGR code before this segment (for state restoration)
  activeSgr?: string;
}

const MAX_LINE_LENGTH = 2000;

// Cursor-positioning and erase sequences used by TUI apps (nano, vim, htop).
// If a chunk contains these, we skip highlighting entirely.
const TUI_SEQUENCE = /\x1b\[[\d;]*[ABCDEFGHJKST]/;

// Matches any complete ANSI escape sequence
const ANSI_REGEX = /\x1b(?:[@-Z\\-_]|\[[0-9;?>=!]*[@-~])/g;

// Matches SGR sequences (color/style setters) specifically — used to track active color state
const SGR_REGEX = /\x1b\[[0-9;]*m/;

// All patterns, ordered roughly by specificity. Priority determines which wins on overlap.
const ALL_PATTERNS: HighlightPattern[] = [
  // IPv4 with optional :port — well-bounded, very specific
  {
    name: "ipv4",
    regex:
      /(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(?::\d{1,5})?/g,
    ansiCode: ANSI.magenta,
    priority: 10,
    category: "ipAddresses",
  },

  // Bracket timestamps [HH:MM] or [HH:MM:SS] — tight range checks prevent false positives
  {
    name: "timestamp-bracket",
    regex: /\[(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\]/g,
    ansiCode: ANSI.brightBlack,
    priority: 9,
    category: "timestamps",
  },

  // ISO 8601 date with optional time. Require non-digit before to avoid matching
  // inside version strings like "1.2024.3". The \b on the right ensures we don't
  // match partial tokens.
  {
    name: "timestamp-iso",
    regex:
      /(?<![0-9])\b\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g,
    ansiCode: ANSI.brightBlack,
    priority: 9,
    category: "timestamps",
  },

  // Error-level keywords — case-insensitive, catches "Error", "error", "FAILED", etc.
  {
    name: "log-error",
    regex:
      /\b(?:error|fatal|critical|fail(?:ed)?|denied|exception)\b|\[(?:error|fatal|critical)\]/gi,
    ansiCode: ANSI.brightRed,
    priority: 9,
    category: "logLevels",
  },

  // Warning-level keywords — case-insensitive
  {
    name: "log-warn",
    regex: /\b(?:warn(?:ing)?|alert|caution)\b|\[warn(?:ing)?\]/gi,
    ansiCode: ANSI.brightYellow,
    priority: 9,
    category: "logLevels",
  },

  // Success keywords — kept conservative to avoid noise
  {
    name: "log-success",
    regex: /\b(?:success(?:ful(?:ly)?)?|pass(?:ed)?|complete(?:d)?|ok\b)\b/gi,
    ansiCode: ANSI.brightGreen,
    priority: 8,
    category: "logLevels",
  },

  // URLs — blue + underline
  {
    name: "url",
    regex: /https?:\/\/[^\s\])}>"']+/g,
    ansiCode: `${ANSI.blue}${ANSI.underline}`,
    priority: 8,
    category: "urls",
  },

  // Absolute paths — permissive character class that allows *, ?, [], globs, etc.
  // Requires at least one slash after the root segment so we don't match bare /dev or /tmp.
  // Boundary: must start at beginning of text or after whitespace/colon/comma/paren.
  {
    name: "path-absolute",
    regex:
      /(?:(?<=^)|(?<=[\s:,;('"]))\/[^\s"'`|<>&;\\]+(?:\/[^\s"'`|<>&;\\]+)+/g,
    ansiCode: ANSI.cyan,
    priority: 7,
    category: "paths",
  },

  // Home-relative paths
  {
    name: "path-home",
    regex: /~\/[^\s"'`|<>&;(){}[\]\\]+/g,
    ansiCode: ANSI.cyan,
    priority: 7,
    category: "paths",
  },

  // Info keyword
  {
    name: "log-info",
    regex: /\binfo\b|\[info\]/gi,
    ansiCode: ANSI.blue,
    priority: 6,
    category: "logLevels",
  },

  // Debug/trace
  {
    name: "log-debug",
    regex: /\b(?:debug|trace|verbose)\b|\[(?:debug|trace)\]/gi,
    ansiCode: ANSI.brightBlack,
    priority: 6,
    category: "logLevels",
  },

  // Labeled numbers: port 8080, exit 1, code 127, status 404, signal 9, returned 0
  // Captures just the number portion so only the digit is highlighted.
  {
    name: "number-labeled",
    regex: /\b(?:port|exit|code|status|signal|returned?)\s+(\d+)\b/gi,
    ansiCode: ANSI.brightCyan,
    priority: 5,
    category: "numbers",
  },
];

function hasIncompleteAnsiSequence(text: string): boolean {
  return /\x1b\[[0-9;?>=!]*$/.test(text);
}

function parseAnsiSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  ANSI_REGEX.lastIndex = 0;
  let lastIndex = 0;
  let activeSgr = "";
  let match;

  while ((match = ANSI_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        isAnsi: false,
        content: text.slice(lastIndex, match.index),
        activeSgr,
      });
    }
    const seq = match[0];
    segments.push({ isAnsi: true, content: seq });
    // Track the active SGR state so we can restore it after a highlight reset
    if (SGR_REGEX.test(seq)) {
      activeSgr = seq === ANSI.reset ? "" : seq;
    }
    lastIndex = ANSI_REGEX.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ isAnsi: false, content: text.slice(lastIndex), activeSgr });
  }

  return segments;
}

function highlightPlainText(
  text: string,
  activePatterns: HighlightPattern[],
  activeSgr: string,
): string {
  if (text.length > MAX_LINE_LENGTH || !text.trim()) return text;

  const matches: MatchResult[] = [];

  for (const pattern of activePatterns) {
    pattern.regex.lastIndex = 0;
    let m;
    while ((m = pattern.regex.exec(text)) !== null) {
      // For patterns with a capture group (labeled numbers), highlight only the capture
      if (m[1] !== undefined) {
        const captureOffset = m[0].indexOf(m[1], m[0].search(/\d/));
        const captureStart = m.index + captureOffset;
        const captureEnd = captureStart + m[1].length;
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          ansiCode: pattern.ansiCode,
          priority: pattern.priority,
          captureStart,
          captureEnd,
        });
      } else {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          ansiCode: pattern.ansiCode,
          priority: pattern.priority,
        });
      }
    }
  }

  if (matches.length === 0) return text;

  // Highest priority wins; ties broken by earlier start position
  matches.sort((a, b) =>
    a.priority !== b.priority ? b.priority - a.priority : a.start - b.start,
  );

  const used: Array<{ start: number; end: number }> = [];
  const final = matches.filter((m) => {
    const overlaps = used.some(
      (r) =>
        (m.start >= r.start && m.start < r.end) ||
        (m.end > r.start && m.end <= r.end) ||
        (m.start <= r.start && m.end >= r.end),
    );
    if (!overlaps) {
      used.push({ start: m.start, end: m.end });
      return true;
    }
    return false;
  });

  // Apply in reverse order so indices stay valid as we insert escape codes
  final.sort((a, b) => a.start - b.start).reverse();

  let result = text;
  for (const m of final) {
    const hs = m.captureStart ?? m.start;
    const he = m.captureEnd ?? m.end;

    // After reset, re-emit the SGR that was active before this plain-text segment
    // so we don't clobber colors set by the server earlier in the line.
    const restore = activeSgr || "";
    result =
      result.slice(0, hs) +
      m.ansiCode +
      result.slice(hs, he) +
      ANSI.reset +
      restore +
      result.slice(he);
  }

  return result;
}

function buildActivePatterns(
  options: SyntaxHighlightOptions,
): HighlightPattern[] {
  return ALL_PATTERNS.filter((p) => options[p.category] !== false);
}

function highlightLine(
  line: string,
  activePatterns: HighlightPattern[],
): string {
  const cr = line.endsWith("\r");
  const bare = cr ? line.slice(0, -1) : line;

  if (!bare.trim()) return line;

  const segments = parseAnsiSegments(bare);
  const result = segments
    .map((s) =>
      s.isAnsi
        ? s.content
        : highlightPlainText(s.content, activePatterns, s.activeSgr ?? ""),
    )
    .join("");

  return cr ? result + "\r" : result;
}

export function highlightTerminalOutput(
  text: string,
  options: SyntaxHighlightOptions = {},
): string {
  if (!text || !text.trim()) return text;
  if (hasIncompleteAnsiSequence(text)) return text;

  if (TUI_SEQUENCE.test(text)) return text;

  const activePatterns = buildActivePatterns(options);
  if (activePatterns.length === 0) return text;

  return text
    .split("\n")
    .map((line) => highlightLine(line, activePatterns))
    .join("\n");
}
