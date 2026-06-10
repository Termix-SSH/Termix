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

interface HighlightPattern {
  name: string;
  regex: RegExp;
  ansiCode: string;
  priority: number;
}

interface MatchResult {
  start: number;
  end: number;
  ansiCode: string;
  priority: number;
}

interface TextSegment {
  isAnsi: boolean;
  content: string;
}

const MAX_LINE_LENGTH = 2000;

// Cursor-positioning and erase sequences used by TUI apps (nano, vim, htop).
// If a chunk contains these, we skip highlighting entirely — the content is
// a screen-layout frame, not scrolling log output.
const TUI_SEQUENCE = /\x1b\[[\d;]*[ABCDEFGHJKST]/;

const PATTERNS: HighlightPattern[] = [
  // IPv4 with optional :port
  {
    name: "ipv4",
    regex:
      /(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(?::\d{1,5})?/g,
    ansiCode: ANSI.magenta,
    priority: 10,
  },

  // Bracket timestamps like [12:34:56] or [12:34] -- must be exactly HH:MM or HH:MM:SS
  {
    name: "timestamp-bracket",
    regex: /\[\d{2}:\d{2}(?::\d{2})?\]/g,
    ansiCode: ANSI.brightBlack,
    priority: 9,
  },

  // ISO 8601 date (date only or with time)
  {
    name: "timestamp-iso",
    regex:
      /\b\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g,
    ansiCode: ANSI.brightBlack,
    priority: 9,
  },

  // Error-level log keywords
  {
    name: "log-error",
    regex: /\b(?:ERROR|FATAL|CRITICAL|FAIL(?:ED)?|DENIED)\b|\[ERROR\]/g,
    ansiCode: ANSI.brightRed,
    priority: 9,
  },

  // Warning-level log keywords
  {
    name: "log-warn",
    regex: /\b(?:WARN(?:ING)?|ALERT)\b|\[WARN(?:ING)?\]/g,
    ansiCode: ANSI.brightYellow,
    priority: 9,
  },

  // Unambiguous success keywords only (removed up/active/connected -- too noisy)
  {
    name: "log-success",
    regex: /\b(?:SUCCESS|PASS(?:ED)?|COMPLETE(?:D)?)\b/g,
    ansiCode: ANSI.brightGreen,
    priority: 8,
  },

  // URLs
  {
    name: "url",
    regex: /https?:\/\/[^\s\])}>"']+/g,
    ansiCode: `${ANSI.blue}${ANSI.underline}`,
    priority: 8,
  },

  // Absolute paths -- must have at least one slash separator to avoid matching
  // single path components like /dev or /tmp alone
  {
    name: "path-absolute",
    regex: /\/[a-zA-Z0-9_.@-]+(?:\/[a-zA-Z0-9_.@-]+)+/g,
    ansiCode: ANSI.cyan,
    priority: 7,
  },

  // Home-relative paths
  {
    name: "path-home",
    regex: /~\/[^\s\x1b"'`(){}\[\]<>|&;\\]+/g,
    ansiCode: ANSI.cyan,
    priority: 7,
  },

  // Info-level log keywords
  {
    name: "log-info",
    regex: /\bINFO\b|\[INFO\]/g,
    ansiCode: ANSI.blue,
    priority: 6,
  },

  // Debug/trace log keywords
  {
    name: "log-debug",
    regex: /\b(?:DEBUG|TRACE)\b|\[(?:DEBUG|TRACE)\]/g,
    ansiCode: ANSI.brightBlack,
    priority: 6,
  },

  // Standalone port/exit-code numbers: digits preceded by "port ", ":", exit code context
  // Very conservative -- only fire when clearly a port or labeled number
  {
    name: "number-port",
    regex: /(?<=\bport\s)\d+\b/g,
    ansiCode: ANSI.brightCyan,
    priority: 5,
  },
];

// Matches any ANSI escape sequence (complete)
const ANSI_REGEX = /\x1b(?:[@-Z\\-_]|\[[0-9;?>=!]*[@-~])/g;

function hasIncompleteAnsiSequence(text: string): boolean {
  return /\x1b\[[0-9;?>=!]*$/.test(text);
}

function parseAnsiSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  ANSI_REGEX.lastIndex = 0;
  let lastIndex = 0;
  let match;

  while ((match = ANSI_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ isAnsi: false, content: text.slice(lastIndex, match.index) });
    }
    segments.push({ isAnsi: true, content: match[0] });
    lastIndex = ANSI_REGEX.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ isAnsi: false, content: text.slice(lastIndex) });
  }

  return segments;
}

function highlightPlainText(text: string): string {
  if (text.length > MAX_LINE_LENGTH || !text.trim()) return text;

  const matches: MatchResult[] = [];

  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    let m;
    while ((m = pattern.regex.exec(text)) !== null) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        ansiCode: pattern.ansiCode,
        priority: pattern.priority,
      });
    }
  }

  if (matches.length === 0) return text;

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

  let result = text;
  final.reverse().forEach((m) => {
    result =
      result.slice(0, m.start) +
      m.ansiCode +
      result.slice(m.start, m.end) +
      ANSI.reset +
      result.slice(m.end);
  });

  return result;
}

function highlightLine(line: string): string {
  // Strip the trailing \r if present (TTY uses \r\n)
  const cr = line.endsWith("\r");
  const bare = cr ? line.slice(0, -1) : line;

  if (!bare.trim()) return line;

  const segments = parseAnsiSegments(bare);
  const result = segments
    .map((s) => (s.isAnsi ? s.content : highlightPlainText(s.content)))
    .join("");

  return cr ? result + "\r" : result;
}

export function highlightTerminalOutput(text: string): string {
  if (!text || !text.trim()) return text;
  if (hasIncompleteAnsiSequence(text)) return text;

  // Skip highlighting for TUI app frames (nano, vim, htop cursor-positioning output)
  if (TUI_SEQUENCE.test(text)) return text;

  return text.split("\n").map(highlightLine).join("\n");
}
