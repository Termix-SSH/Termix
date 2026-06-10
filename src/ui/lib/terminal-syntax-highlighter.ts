const ANSI = {
  reset: "\x1b[0m",
  // Standard colors
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  // Bright colors
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",
  // Styles
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  underline: "\x1b[4m",
  // True-color brand orange matching --accent-brand: #f59145
  brandOrange: "\x1b[38;2;245;145;69m",
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

const MAX_LINE_LENGTH = 5000;

const PATTERNS: HighlightPattern[] = [
  // user@hostname prompt segments -- brand orange to match app accent
  {
    name: "shell-prompt",
    regex: /\b([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+)\b/g,
    ansiCode: ANSI.brandOrange,
    priority: 11,
  },

  // IPv4 addresses with optional port
  {
    name: "ipv4",
    regex:
      /(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(?::\d{1,5})?/g,
    ansiCode: ANSI.magenta,
    priority: 10,
  },

  // ISO dates and bracket timestamps like [12:34:56]
  {
    name: "timestamp",
    regex:
      /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b|\[\d{2}:\d{2}(?::\d{2})?\]/g,
    ansiCode: ANSI.brightBlack,
    priority: 9,
  },

  // Error-level log keywords
  {
    name: "log-error",
    regex: /\b(ERROR|FATAL|CRITICAL|FAIL(?:ED)?|DENIED)\b|\[ERROR\]/gi,
    ansiCode: ANSI.brightRed,
    priority: 9,
  },

  // Warning-level log keywords
  {
    name: "log-warn",
    regex: /\b(WARN(?:ING)?|ALERT)\b|\[WARN(?:ING)?\]/gi,
    ansiCode: ANSI.yellow,
    priority: 9,
  },

  // Success-level log keywords (removed "up"/"active"/"connected" -- too many false positives)
  {
    name: "log-success",
    regex: /\b(SUCCESS|OK|PASS(?:ED)?|COMPLETE(?:D)?|FULL)\b/gi,
    ansiCode: ANSI.brightGreen,
    priority: 8,
  },

  // URLs
  {
    name: "url",
    regex: /https?:\/\/[^\s\])}]+/g,
    ansiCode: `${ANSI.blue}${ANSI.underline}`,
    priority: 8,
  },

  // Absolute filesystem paths -- relaxed regex, negative lookbehind avoids matching inside URLs
  {
    name: "path-absolute",
    regex: /(?<![:\w])\/(?:[^\s\x1b"'`(){}\[\]<>|&;\\])+(?:\/(?:[^\s\x1b"'`(){}\[\]<>|&;\\])*)*/g,
    ansiCode: ANSI.cyan,
    priority: 7,
  },

  // Home-relative paths (~/)
  {
    name: "path-home",
    regex: /~\/[^\s\x1b"'`(){}\[\]<>|&;\\]+/g,
    ansiCode: ANSI.cyan,
    priority: 7,
  },

  // Info-level log keywords
  {
    name: "log-info",
    regex: /\bINFO\b|\[INFO\]/gi,
    ansiCode: ANSI.blue,
    priority: 6,
  },

  // Debug/trace log keywords
  {
    name: "log-debug",
    regex: /\b(?:DEBUG|TRACE)\b|\[(?:DEBUG|TRACE)\]/gi,
    ansiCode: ANSI.brightBlack,
    priority: 6,
  },

  // Standalone numbers (ports, exit codes, counts) surrounded by non-word context
  {
    name: "number",
    regex: /(?<=[\s:[(,])(\d+)(?=[\s\],:).]|$)/g,
    ansiCode: ANSI.brightCyan,
    priority: 5,
  },
];

function hasIncompleteAnsiSequence(text: string): boolean {
  // Only bail out when ESC[ is present but not yet terminated by a letter
  return /\x1b\[[0-9;?>=!]*$/.test(text);
}

function parseAnsiSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const ansiRegex = /\x1b(?:[@-Z\\-_]|\[[0-9;?>=!]*[@-~])/g;
  let lastIndex = 0;
  let match;

  while ((match = ansiRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ isAnsi: false, content: text.slice(lastIndex, match.index) });
    }
    segments.push({ isAnsi: true, content: match[0] });
    lastIndex = ansiRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ isAnsi: false, content: text.slice(lastIndex) });
  }

  return segments;
}

function highlightPlainText(text: string): string {
  if (text.length > MAX_LINE_LENGTH || !text.trim()) {
    return text;
  }

  const matches: MatchResult[] = [];

  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        ansiCode: pattern.ansiCode,
        priority: pattern.priority,
      });
    }
  }

  if (matches.length === 0) return text;

  // Sort by priority descending, then position ascending
  matches.sort((a, b) =>
    a.priority !== b.priority ? b.priority - a.priority : a.start - b.start,
  );

  const appliedRanges: Array<{ start: number; end: number }> = [];
  const finalMatches = matches.filter((match) => {
    const overlaps = appliedRanges.some(
      (r) =>
        (match.start >= r.start && match.start < r.end) ||
        (match.end > r.start && match.end <= r.end) ||
        (match.start <= r.start && match.end >= r.end),
    );
    if (!overlaps) {
      appliedRanges.push({ start: match.start, end: match.end });
      return true;
    }
    return false;
  });

  let result = text;
  // Apply in reverse order so offsets remain valid
  finalMatches.reverse().forEach((match) => {
    result =
      result.slice(0, match.start) +
      match.ansiCode +
      result.slice(match.start, match.end) +
      ANSI.reset +
      result.slice(match.end);
  });

  return result;
}

function highlightLine(line: string): string {
  if (!line.trim()) return line;
  const segments = parseAnsiSegments(line);
  return segments
    .map((s) => (s.isAnsi ? s.content : highlightPlainText(s.content)))
    .join("");
}

export function highlightTerminalOutput(text: string): string {
  if (!text || !text.trim()) return text;
  if (hasIncompleteAnsiSequence(text)) return text;
  // Process line-by-line so patterns don't accidentally span across prompt/output boundaries
  return text.split("\n").map(highlightLine).join("\n");
}
