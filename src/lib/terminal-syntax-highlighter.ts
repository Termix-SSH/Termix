/**
 * Terminal Syntax Highlighter
 *
 * Adds syntax highlighting to terminal output by injecting ANSI color codes
 * for common patterns like commands, paths, IPs, log levels, and keywords.
 *
 * Features:
 * - Preserves existing ANSI codes from SSH output
 * - Performance-optimized for streaming logs
 * - Priority-based pattern matching to avoid overlaps
 * - Configurable via localStorage
 */

// ANSI escape code constants
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
    brightBlack: "\x1b[90m", // Gray
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

// Pattern definition interface
interface HighlightPattern {
  name: string;
  regex: RegExp;
  ansiCode: string;
  priority: number;
  quickCheck?: string; // Optional fast string.includes() check
}

// Match result interface for tracking ranges
interface MatchResult {
  start: number;
  end: number;
  ansiCode: string;
  priority: number;
}

// Configuration
const MAX_LINE_LENGTH = 5000; // Skip highlighting for very long lines
const MAX_ANSI_CODES = 10; // Skip if text has many ANSI codes (likely already colored/interactive app)

// Pattern definitions by category (pre-compiled)
// Based on SecureCRT proven patterns with strict boundaries
const PATTERNS: HighlightPattern[] = [
  // Priority 1: IP Addresses (HIGHEST - from SecureCRT line 94)
  // Matches: 192.168.1.1, 10.0.0.5, 127.0.0.1:8080
  // WON'T match: dates like "2025" or "03:11:36"
  {
    name: "ipv4",
    regex:
      /(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(?::\d{1,5})?/g,
    ansiCode: ANSI_CODES.colors.magenta,
    priority: 10,
  },

  // Priority 2: Log Levels - Error (bright red)
  {
    name: "log-error",
    regex:
      /\b(ERROR|FATAL|CRITICAL|FAIL(?:ED)?|denied|invalid|DENIED)\b|\[ERROR\]/gi,
    ansiCode: ANSI_CODES.colors.brightRed,
    priority: 9,
  },

  // Priority 3: Log Levels - Warning (yellow)
  {
    name: "log-warn",
    regex: /\b(WARN(?:ING)?|ALERT)\b|\[WARN(?:ING)?\]/gi,
    ansiCode: ANSI_CODES.colors.yellow,
    priority: 9,
  },

  // Priority 4: Log Levels - Success (bright green)
  {
    name: "log-success",
    regex:
      /\b(SUCCESS|OK|PASS(?:ED)?|COMPLETE(?:D)?|connected|active|up|Up|UP|FULL)\b/gi,
    ansiCode: ANSI_CODES.colors.brightGreen,
    priority: 8,
  },

  // Priority 5: URLs (must start with http/https)
  {
    name: "url",
    regex: /https?:\/\/[^\s\])}]+/g,
    ansiCode: `${ANSI_CODES.colors.blue}${ANSI_CODES.styles.underline}`,
    priority: 8,
  },

  // Priority 6: Absolute paths - STRICT (must have 2+ segments)
  // Matches: /var/log/file.log, /home/user/docs
  // WON'T match: /03, /2025, single segments
  {
    name: "path-absolute",
    regex: /\/[a-zA-Z][a-zA-Z0-9_\-@.]*(?:\/[a-zA-Z0-9_\-@.]+)+/g,
    ansiCode: ANSI_CODES.colors.cyan,
    priority: 7,
  },

  // Priority 7: Home paths
  {
    name: "path-home",
    regex: /~\/[a-zA-Z0-9_\-@./]+/g,
    ansiCode: ANSI_CODES.colors.cyan,
    priority: 7,
  },

  // Priority 8: Other log levels
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

/**
 * Check if text contains existing ANSI escape sequences
 */
function hasExistingAnsiCodes(text: string): boolean {
  // Count all ANSI escape sequences (not just CSI)
  const ansiCount = (
    text.match(
      /\x1b[\[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PRZcf-nq-uy=><~]/g,
    ) || []
  ).length;
  return ansiCount > MAX_ANSI_CODES;
}

/**
 * Check if text appears to be incomplete (partial ANSI sequence at end)
 */
function hasIncompleteAnsiSequence(text: string): boolean {
  // Check if text ends with incomplete ANSI escape sequence
  return /\x1b(?:\[(?:[0-9;]*)?)?$/.test(text);
}

/**
 * Parse text into segments: plain text and ANSI codes
 */
interface TextSegment {
  isAnsi: boolean;
  content: string;
}

function parseAnsiSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  // More comprehensive ANSI regex - matches SGR (colors), cursor movement, erase sequences, etc.
  const ansiRegex = /\x1b(?:[@-Z\\-_]|\[[0-9;]*[@-~])/g;
  let lastIndex = 0;
  let match;

  while ((match = ansiRegex.exec(text)) !== null) {
    // Plain text before ANSI code
    if (match.index > lastIndex) {
      segments.push({
        isAnsi: false,
        content: text.slice(lastIndex, match.index),
      });
    }

    // ANSI code itself
    segments.push({
      isAnsi: true,
      content: match[0],
    });

    lastIndex = ansiRegex.lastIndex;
  }

  // Remaining plain text
  if (lastIndex < text.length) {
    segments.push({
      isAnsi: false,
      content: text.slice(lastIndex),
    });
  }

  return segments;
}

/**
 * Apply highlights to plain text (no ANSI codes)
 */
function highlightPlainText(text: string): string {
  // Skip very long lines for performance
  if (text.length > MAX_LINE_LENGTH) {
    return text;
  }

  // Skip if text is empty or whitespace
  if (!text.trim()) {
    return text;
  }

  // Find all matches for all patterns
  const matches: MatchResult[] = [];

  for (const pattern of PATTERNS) {
    // Reset regex lastIndex
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

  // If no matches, return original text
  if (matches.length === 0) {
    return text;
  }

  // Sort matches by priority (descending) then by position
  matches.sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    return a.start - b.start;
  });

  // Filter out overlapping matches (keep higher priority)
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

  // Apply ANSI codes from end to start (to preserve indices)
  let result = text;
  finalMatches.reverse().forEach((match) => {
    const before = result.slice(0, match.start);
    const matched = result.slice(match.start, match.end);
    const after = result.slice(match.end);

    result = before + match.ansiCode + matched + ANSI_CODES.reset + after;
  });

  return result;
}

/**
 * Main export: Highlight terminal output text
 *
 * @param text - Terminal output text (may contain ANSI codes)
 * @returns Text with syntax highlighting applied
 */
export function highlightTerminalOutput(text: string): string {
  // Early exit for empty or whitespace-only text
  if (!text || !text.trim()) {
    return text;
  }

  // Skip highlighting if text has incomplete ANSI sequence (streaming chunk)
  if (hasIncompleteAnsiSequence(text)) {
    return text;
  }

  // Skip highlighting if text already has many ANSI codes
  // (likely already styled by SSH output or application)
  if (hasExistingAnsiCodes(text)) {
    return text;
  }

  // Parse text into segments (plain text vs ANSI codes)
  const segments = parseAnsiSegments(text);

  // If no ANSI codes found, highlight entire text
  if (segments.length === 0) {
    return highlightPlainText(text);
  }

  // Highlight only plain text segments, preserve ANSI segments
  const highlightedSegments = segments.map((segment) => {
    if (segment.isAnsi) {
      return segment.content; // Preserve existing ANSI codes
    } else {
      return highlightPlainText(segment.content);
    }
  });

  return highlightedSegments.join("");
}

/**
 * Check if syntax highlighting is enabled in localStorage
 * Defaults to false if not set (opt-in behavior - BETA feature)
 */
export function isSyntaxHighlightingEnabled(): boolean {
  try {
    return localStorage.getItem("terminalSyntaxHighlighting") === "true";
  } catch {
    // If localStorage is not available, default to disabled
    return false;
  }
}
