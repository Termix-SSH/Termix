import type { Terminal } from "@xterm/xterm";

/**
 * How much scrollback to hand out by default. Bounded on purpose: a
 * long-running session holds megabytes, and nothing consuming this wants all
 * of it.
 */
export const DEFAULT_BUFFER_CONTEXT_LINES = 200;

/**
 * Serializes the tail of a terminal's buffer to plain text.
 *
 * Wrapped rows are joined back onto the line they continue. xterm splits one
 * logical line across several buffer rows when it wraps, so emitting a newline
 * per row would chop long commands in half.
 */
export function getTerminalBufferText(
  terminal: Terminal | null | undefined,
  maxLines: number = DEFAULT_BUFFER_CONTEXT_LINES,
): string {
  if (!terminal || maxLines <= 0) return "";

  try {
    const buffer = terminal.buffer.active;
    const end = buffer.baseY + terminal.rows;
    const start = Math.max(0, end - maxLines);

    const lines: string[] = [];
    for (let i = start; i < end; i++) {
      const line = buffer.getLine(i);
      if (!line) continue;
      const text = line.translateToString(true);
      if (line.isWrapped && lines.length > 0) {
        lines[lines.length - 1] += text;
      } else {
        lines.push(text);
      }
    }

    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
  } catch {
    // Called from a click handler. A disposed terminal returns nothing
    // rather than breaking the click.
    return "";
  }
}
