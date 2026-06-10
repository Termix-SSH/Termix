import { describe, it, expect } from "vitest";
import { highlightTerminalOutput } from "./terminal-syntax-highlighter.js";

const ESC = "\x1b";

describe("highlightTerminalOutput", () => {
  it("returns empty/whitespace text unchanged", () => {
    expect(highlightTerminalOutput("")).toBe("");
    expect(highlightTerminalOutput("   ")).toBe("   ");
  });

  it("wraps error keywords in bright red ANSI codes", () => {
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

  it("highlights text that already has many ANSI codes (no bail-out)", () => {
    // Previously bailed out at > 10 ANSI codes; now always highlights plain segments
    let heavy = "";
    for (let i = 0; i < 12; i++) heavy += `${ESC}[32mgreen${ESC}[0m `;
    heavy += "ERROR at line 5";
    const out = highlightTerminalOutput(heavy);
    // Should still highlight ERROR even though there are many ANSI codes
    expect(out).toContain(ESC + "[91m");
  });

  it("does not process lines exceeding MAX_LINE_LENGTH", () => {
    const huge = "ERROR " + "x".repeat(6000);
    expect(highlightTerminalOutput(huge)).toBe(huge);
  });

  it("highlights user@hostname in brand orange", () => {
    const out = highlightTerminalOutput("luke@myserver:~$");
    // True-color brand orange escape
    expect(out).toContain(ESC + "[38;2;245;145;69m");
    expect(out).toContain("luke@myserver");
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

  it("highlights standalone numbers in bright cyan", () => {
    const out = highlightTerminalOutput("listening on port 8080:");
    expect(out).toContain(ESC + "[96m");
    expect(out).toContain("8080");
  });

  it("does not highlight 'up' or 'active' as success (false positive regression)", () => {
    const out = highlightTerminalOutput("service is up and running");
    // brightGreen should not appear for "up"
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

  it("processes multi-line text line by line", () => {
    const text = "user@host:~$\nsome output\nERROR: failed";
    const out = highlightTerminalOutput(text);
    // Orange on first line
    expect(out).toContain(ESC + "[38;2;245;145;69m");
    // Red on last line
    expect(out).toContain(ESC + "[91m");
  });
});
