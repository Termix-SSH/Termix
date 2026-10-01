import { describe, expect, it } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { getTerminalBufferText } from "../../../src/frontend/terminal/terminal-buffer-text";

interface FakeLine {
  text: string;
  wrapped?: boolean;
}

/** Minimal stand-in for the parts of xterm this reads. */
function fakeTerminal(lines: FakeLine[], rows = lines.length): Terminal {
  return {
    rows,
    buffer: {
      active: {
        baseY: Math.max(0, lines.length - rows),
        getLine: (i: number) => {
          const line = lines[i];
          if (!line) return undefined;
          return {
            isWrapped: !!line.wrapped,
            translateToString: () => line.text,
          };
        },
      },
    },
  } as unknown as Terminal;
}

describe("getTerminalBufferText", () => {
  it("returns an empty string for a missing terminal", () => {
    expect(getTerminalBufferText(null)).toBe("");
    expect(getTerminalBufferText(undefined)).toBe("");
  });

  it("joins buffer rows with newlines", () => {
    const terminal = fakeTerminal([{ text: "$ whoami" }, { text: "root" }]);

    expect(getTerminalBufferText(terminal)).toBe("$ whoami\nroot");
  });

  it("joins a wrapped row onto the line it continues", () => {
    const terminal = fakeTerminal([
      { text: "$ echo start" },
      { text: "a-very-long-command " },
      { text: "that-wrapped", wrapped: true },
    ]);

    expect(getTerminalBufferText(terminal)).toBe(
      "$ echo start\na-very-long-command that-wrapped",
    );
  });

  it("drops trailing blank lines", () => {
    const terminal = fakeTerminal([
      { text: "output" },
      { text: "" },
      { text: "" },
    ]);

    expect(getTerminalBufferText(terminal)).toBe("output");
  });

  it("keeps blank lines in the middle", () => {
    const terminal = fakeTerminal([
      { text: "one" },
      { text: "" },
      { text: "two" },
    ]);

    expect(getTerminalBufferText(terminal)).toBe("one\n\ntwo");
  });

  it("bounds the result to maxLines, keeping the tail", () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({ text: `line ${i}` }));
    const terminal = fakeTerminal(lines, 50);

    const result = getTerminalBufferText(terminal, 3);

    expect(result).toBe("line 47\nline 48\nline 49");
  });

  it("returns an empty string for a non-positive maxLines", () => {
    const terminal = fakeTerminal([{ text: "anything" }]);

    expect(getTerminalBufferText(terminal, 0)).toBe("");
  });

  it("returns an empty string when the buffer throws", () => {
    const disposed = {
      rows: 1,
      get buffer(): never {
        throw new Error("terminal disposed");
      },
    } as unknown as Terminal;

    expect(getTerminalBufferText(disposed)).toBe("");
  });
});
