import { describe, it, expect } from "vitest";
import { highlightTerminalOutput } from "./terminal-syntax-highlighter.js";

const ESC = "\x1b";

describe("highlightTerminalOutput", () => {
  it("returns empty/whitespace text unchanged", () => {
    expect(highlightTerminalOutput("")).toBe("");
    expect(highlightTerminalOutput("   ")).toBe("   ");
  });

  it("wraps error keywords in red ANSI codes", () => {
    const out = highlightTerminalOutput("Something ERROR happened");
    expect(out).toContain(ESC + "[91m");
    expect(out).toContain(ESC + "[0m");
    expect(out).toContain("ERROR");
  });

  it("highlights IPv4 addresses", () => {
    const out = highlightTerminalOutput("connect to 192.168.1.10 now");
    expect(out).toContain("192.168.1.10");
    expect(out).toContain(ESC + "[35m"); // magenta
  });

  it("leaves text with no matchable tokens unchanged", () => {
    const plain = "just a normal sentence here";
    expect(highlightTerminalOutput(plain)).toBe(plain);
  });

  it("does not re-highlight text that already contains many ANSI codes", () => {
    let heavy = "";
    for (let i = 0; i < 12; i++) heavy += `${ESC}[32mgreen${ESC}[0m `;
    expect(highlightTerminalOutput(heavy)).toBe(heavy);
  });

  it("leaves text ending in an incomplete ANSI escape untouched", () => {
    const partial = `loading${ESC}[`;
    expect(highlightTerminalOutput(partial)).toBe(partial);
  });

  it("does not exceed MAX_LINE_LENGTH processing on huge lines", () => {
    const huge = "ERROR " + "x".repeat(6000);
    // Over the 5000 char cap, highlightPlainText returns the input unchanged.
    expect(highlightTerminalOutput(huge)).toBe(huge);
  });
});
