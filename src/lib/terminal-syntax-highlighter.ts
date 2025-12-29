const ANSI_CODES = {
  reset: "\x1b[0m",
  colors: {
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    brightBlack: "\x1b[90m",
    brightRed: "\x1b[91m",
    brightGreen: "\x1b[92m",
    brightYellow: "\x1b[93m",
    brightBlue: "\x1b[94m",
    brightMagenta: "\x1b[95m",
    brightCyan: "\x1b[96m",
    brightWhite: "\x1b[97m",
  },
  styles: {
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    italic: "\x1b[3m",
    underline: "\x1b[4m",
  },
} as const;

interface HighlightPattern {
  name: string;
  regex: RegExp;
  ansiCode: string;
  priority: number;
  quickCheck?: string;
}

interface MatchResult {
  start: number;
  end: number;
  ansiCode: string;
  priority: number;
}

const MAX_LINE_LENGTH = 5000;
const MAX_ANSI_CODES = 10;

const PATTERNS: HighlightPattern[] = [
  {
    name: "ipv4",
    regex:
      /(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(?::\d{1,5})?/g,
    ansiCode: ANSI_CODES.colors.magenta,
    priority: 10,
  },

  {
    name: "log-error",
    regex:
      /\b(ERROR|FATAL|CRITICAL|FAIL(?:ED)?|denied|invalid|DENIED)\b|\[ERROR\]/gi,
    ansiCode: ANSI_CODES.colors.brightRed,
    priority: 9,
  },

  {
    name: "log-warn",
    regex: /\b(WARN(?:ING)?|ALERT)\b|\[WARN(?:ING)?\]/gi,
    ansiCode: ANSI_CODES.colors.yellow,
    priority: 9,
  },

  {
    name: "log-success",
    regex:
      /\b(SUCCESS|OK|PASS(?:ED)?|COMPLETE(?:D)?|connected|active|up|Up|UP|FULL)\b/gi,
    ansiCode: ANSI_CODES.colors.brightGreen,
    priority: 8,
  },

  {
    name: "url",
    regex: /https?:\/\/[^\s\])}]+/g,
    ansiCode: `${ANSI_CODES.colors.blue}${ANSI_CODES.styles.underline}`,
    priority: 8,
  },

  {
    name: "path-absolute",
    regex: /\/[a-zA-Z][a-zA-Z0-9_\-@.]*(?:\/[a-zA-Z0-9_\-@.]+)+/g,
    ansiCode: ANSI_CODES.colors.cyan,
    priority: 7,
  },

  {
    name: "path-home",
    regex: /~\/[a-zA-Z0-9_\-@./]+/g,
    ansiCode: ANSI_CODES.colors.cyan,
    priority: 7,
  },

  {
    name: "log-info",
    regex: /\bINFO\b|\[INFO\]/gi,
    ansiCode: ANSI_CODES.colors.blue,
    priority: 6,
  },
  {
    name: "log-debug",
    regex: /\b(?:DEBUG|TRACE)\b|\[(?:DEBUG|TRACE)\]/gi,
    ansiCode: ANSI_CODES.colors.brightBlack,
    priority: 6,
  },
];

function hasExistingAnsiCodes(text: string): boolean {
  const ansiCount = (
    text.match(
      /\x1b[\[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PRZcf-nq-uy=><~]/g,
    ) || []
  ).length;
  return ansiCount > MAX_ANSI_CODES;
}

function hasIncompleteAnsiSequence(text: string): boolean {
  return /\x1b(?:\[(?:[0-9;]*)?)?$/.test(text);
}

interface TextSegment {
  isAnsi: boolean;
  content: string;
}

function parseAnsiSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const ansiRegex = /\x1b(?:[@-Z\\-_]|\[[0-9;]*[@-~])/g;
  let lastIndex = 0;
  let match;

  while ((match = ansiRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        isAnsi: false,
        content: text.slice(lastIndex, match.index),
      });
    }

    segments.push({
      isAnsi: true,
      content: match[0],
    });

    lastIndex = ansiRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({
      isAnsi: false,
      content: text.slice(lastIndex),
    });
  }

  return segments;
}

function highlightPlainText(text: string): string {
  if (text.length > MAX_LINE_LENGTH) {
    return text;
  }

  if (!text.trim()) {
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

  if (matches.length === 0) {
    return text;
  }

  matches.sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    return a.start - b.start;
  });

  const appliedRanges: Array<{ start: number; end: number }> = [];
  const finalMatches = matches.filter((match) => {
    const overlaps = appliedRanges.some(
      (range) =>
        (match.start >= range.start && match.start < range.end) ||
        (match.end > range.start && match.end <= range.end) ||
        (match.start <= range.start && match.end >= range.end),
    );

    if (!overlaps) {
      appliedRanges.push({ start: match.start, end: match.end });
      return true;
    }
    return false;
  });

  let result = text;
  finalMatches.reverse().forEach((match) => {
    const before = result.slice(0, match.start);
    const matched = result.slice(match.start, match.end);
    const after = result.slice(match.end);

    result = before + match.ansiCode + matched + ANSI_CODES.reset + after;
  });

  return result;
}

export function highlightTerminalOutput(text: string): string {
  if (!text || !text.trim()) {
    return text;
  }

  if (hasIncompleteAnsiSequence(text)) {
    return text;
  }

  if (hasExistingAnsiCodes(text)) {
    return text;
  }

  const segments = parseAnsiSegments(text);

  if (segments.length === 0) {
    return highlightPlainText(text);
  }

  const highlightedSegments = segments.map((segment) => {
    if (segment.isAnsi) {
      return segment.content;
    } else {
      return highlightPlainText(segment.content);
    }
  });

  return highlightedSegments.join("");
}

export function isSyntaxHighlightingEnabled(): boolean {
  try {
    return localStorage.getItem("terminalSyntaxHighlighting") === "true";
  } catch {
    return false;
  }
}
