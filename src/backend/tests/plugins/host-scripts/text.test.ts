import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { shellQuote } from "../../../../../packages/plugin-sdk/src/host-scripts/text.js";

// Reads one POSIX shell word made only of '...' parts and \' escapes, the
// way sh would. Returns null if anything else shows up outside quotes.
function readWord(word: string): string | null {
  let out = "";
  let i = 0;
  while (i < word.length) {
    if (word[i] === "'") {
      const end = word.indexOf("'", i + 1);
      if (end === -1) return null;
      out += word.slice(i + 1, end);
      i = end + 1;
    } else if (word[i] === "\\" && word[i + 1] === "'") {
      out += "'";
      i += 2;
    } else {
      return null;
    }
  }
  return out;
}

describe("shellQuote", () => {
  it("always gives back one shell word with the same text", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (value) => {
        expect(readWord(shellQuote(value))).toBe(value);
      }),
      { numRuns: 2000 },
    );
  });

  it("keeps shell syntax inside quotes", () => {
    const shellish = fc.string({
      unit: fc.constantFrom(
        "'",
        '"',
        "\\",
        "$",
        "`",
        ";",
        "|",
        "&",
        "\n",
        " ",
        "-",
        "a",
        "(",
        ")",
        "*",
      ),
    });
    fc.assert(
      fc.property(shellish, (value) => {
        const quoted = shellQuote(value);
        expect(quoted.startsWith("'")).toBe(true);
        expect(quoted.endsWith("'")).toBe(true);
        expect(readWord(quoted)).toBe(value);
      }),
      { numRuns: 2000 },
    );
  });
});
