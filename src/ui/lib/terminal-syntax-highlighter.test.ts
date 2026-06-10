import { describe, it, expect } from "vitest";
import { highlightTerminalOutput } from "./terminal-syntax-highlighter.js";

const ESC = "\x1b";

describe("highlightTerminalOutput", () => {
  it("returns empty/whitespace text unchanged", () => {
    expect(highlightTerminalOutput("")).toBe("");
    expect(highlightTerminalOutput("   ")).toBe("   ");
  });

  it("wraps error keywords in bright red", () => {
    const out = highlightTerminalOutput("Something ERROR happened");
    expect(out).toContain(ESC + "[91m");
    expect(out).toContain(ESC + "[0m");
    expect(out).toContain("ERROR");
  });

  it("highlights IPv4 addresses in magenta", () => {
    const out = highlightTerminalOutput("connect to 192.168.1.10 now");
    expect(out).toContain("192.168.1.10");
    expect(out).toContain(ESC + "[35m");
  });

  it("leaves text with no matchable tokens unchanged", () => {
    const plain = "just a normal sentence here";
    expect(highlightTerminalOutput(plain)).toBe(plain);
  });

  it("leaves text ending in an incomplete ANSI escape untouched", () => {
    const partial = `loading${ESC}[`;
    expect(highlightTerminalOutput(partial)).toBe(partial);
  });

  it("skips TUI cursor-positioning frames (nano/vim protection)", () => {
    // \x1b[H is a cursor-home sequence used by nano/htop
    const tuiFrame = `${ESC}[H${ESC}[2J some nano content`;
    expect(highlightTerminalOutput(tuiFrame)).toBe(tuiFrame);
  });

  it("highlights text that already has ANSI codes (no code-count bail-out)", () => {
    let heavy = "";
    for (let i = 0; i < 12; i++) heavy += `${ESC}[32mgreen${ESC}[0m `;
    heavy += "ERROR at line 5";
    const out = highlightTerminalOutput(heavy);
    expect(out).toContain(ESC + "[91m");
  });

  it("does not process lines exceeding MAX_LINE_LENGTH", () => {
    const huge = "ERROR " + "x".repeat(3000);
    expect(highlightTerminalOutput(huge)).toBe(huge);
  });

  it("highlights absolute paths in cyan", () => {
    const out = highlightTerminalOutput("log at /var/log/nginx/access.log");
    expect(out).toContain(ESC + "[36m");
    expect(out).toContain("/var/log/nginx/access.log");
  });

  it("highlights home paths in cyan", () => {
    const out = highlightTerminalOutput("file: ~/documents/notes.txt");
    expect(out).toContain(ESC + "[36m");
    expect(out).toContain("~/documents/notes.txt");
  });

  it("highlights bracket timestamps in bright black", () => {
    const out = highlightTerminalOutput("[12:34:56] server started");
    expect(out).toContain(ESC + "[90m");
    expect(out).toContain("[12:34:56]");
  });

  it("highlights ISO date timestamps in bright black", () => {
    const out = highlightTerminalOutput("2024-01-15 event occurred");
    expect(out).toContain(ESC + "[90m");
    expect(out).toContain("2024-01-15");
  });

  it("highlights port numbers after the word 'port'", () => {
    const out = highlightTerminalOutput("listening on port 8080");
    expect(out).toContain(ESC + "[96m");
    expect(out).toContain("8080");
  });

  it("does not highlight standalone numbers outside port context", () => {
    // A bare '7' or date component should not get cyan highlight
    const out = highlightTerminalOutput("exit code 1 returned");
    expect(out).not.toContain(ESC + "[96m");
  });

  it("does not highlight 'up' or 'active' as success", () => {
    const out = highlightTerminalOutput("service is up and running");
    expect(out).not.toContain(ESC + "[92m");
  });

  it("still highlights unambiguous success keywords", () => {
    const out = highlightTerminalOutput("Test PASSED successfully");
    expect(out).toContain(ESC + "[92m");
  });

  it("highlights URLs with blue+underline", () => {
    const out = highlightTerminalOutput("visit https://example.com now");
    expect(out).toContain(ESC + "[34m");
    expect(out).toContain(ESC + "[4m");
  });

  it("preserves \\r in CRLF terminal output", () => {
    const out = highlightTerminalOutput("ERROR occurred\r\n");
    expect(out).toContain("\r\n");
  });

  it("processes multi-line text line by line", () => {
    const text = "some output\nERROR: failed";
    const out = highlightTerminalOutput(text);
    expect(out).toContain(ESC + "[91m");
  });
});
