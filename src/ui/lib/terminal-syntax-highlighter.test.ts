import { describe, it, expect } from "vitest";
import { highlightTerminalOutput } from "./terminal-syntax-highlighter.js";

const ESC = "\x1b";

describe("highlightTerminalOutput", () => {
  it("returns empty/whitespace text unchanged", () => {
    expect(highlightTerminalOutput("")).toBe("");
    expect(highlightTerminalOutput("   ")).toBe("   ");
  });

  it("wraps ERROR in bright red", () => {
    const out = highlightTerminalOutput("Something ERROR happened");
    expect(out).toContain(ESC + "[91m");
    expect(out).toContain("ERROR");
  });

  it("wraps lowercase error in bright red (case-insensitive)", () => {
    const out = highlightTerminalOutput("something error happened");
    expect(out).toContain(ESC + "[91m");
  });

  it("wraps Error (mixed case) in bright red", () => {
    const out = highlightTerminalOutput("Error: connection refused");
    expect(out).toContain(ESC + "[91m");
  });

  it("wraps warn (lowercase) in bright yellow", () => {
    const out = highlightTerminalOutput("warn: disk almost full");
    expect(out).toContain(ESC + "[93m");
  });

  it("wraps warning (lowercase) in bright yellow", () => {
    const out = highlightTerminalOutput("warning: something is off");
    expect(out).toContain(ESC + "[93m");
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
    const tuiFrame = `${ESC}[H${ESC}[2J some nano content`;
    expect(highlightTerminalOutput(tuiFrame)).toBe(tuiFrame);
  });

  it("highlights text that already has ANSI codes", () => {
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

  it("highlights simple absolute paths in cyan", () => {
    const out = highlightTerminalOutput("log at /var/log/nginx/access.log");
    expect(out).toContain(ESC + "[36m");
    expect(out).toContain("/var/log/nginx/access.log");
  });

  it("highlights absolute paths with glob wildcards in cyan", () => {
    const out = highlightTerminalOutput("files: /usr/share/doc/*/copyright");
    expect(out).toContain(ESC + "[36m");
    expect(out).toContain("/usr/share/doc/*/copyright");
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

  it("does not highlight out-of-range bracket timestamps", () => {
    // [99:99] is not a valid time
    const out = highlightTerminalOutput("[99:99] something");
    expect(out).not.toContain(ESC + "[90m");
  });

  it("highlights ISO date timestamps in bright black", () => {
    const out = highlightTerminalOutput("2024-01-15 event occurred");
    expect(out).toContain(ESC + "[90m");
    expect(out).toContain("2024-01-15");
  });

  it("does not highlight version strings as ISO dates", () => {
    // 2.4.0 or 1.2024.3 should not trigger ISO date
    const out = highlightTerminalOutput("version 2.4.0 released");
    expect(out).toBe("version 2.4.0 released");
  });

  it("highlights labeled numbers (port)", () => {
    const out = highlightTerminalOutput("listening on port 8080");
    expect(out).toContain(ESC + "[96m");
    expect(out).toContain("8080");
  });

  it("highlights labeled numbers (exit)", () => {
    const out = highlightTerminalOutput("process exited with exit 1");
    expect(out).toContain(ESC + "[96m");
  });

  it("highlights labeled numbers (status)", () => {
    const out = highlightTerminalOutput("returned status 404");
    expect(out).toContain(ESC + "[96m");
  });

  it("does not highlight standalone numbers outside labeled context", () => {
    const out = highlightTerminalOutput("there are 42 files here");
    expect(out).toBe("there are 42 files here");
  });

  it("does not highlight 'up' or 'active' as success", () => {
    const out = highlightTerminalOutput("service is up and running");
    expect(out).not.toContain(ESC + "[92m");
  });

  it("highlights unambiguous success keywords (case-insensitive)", () => {
    const out = highlightTerminalOutput("Test passed successfully");
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

  it("respects category options - disabling logLevels skips error highlight", () => {
    const out = highlightTerminalOutput("ERROR occurred", { logLevels: false });
    expect(out).not.toContain(ESC + "[91m");
  });

  it("respects category options - disabling paths skips path highlight", () => {
    const out = highlightTerminalOutput("at /usr/share/doc/something/file", {
      paths: false,
    });
    expect(out).not.toContain(ESC + "[36m");
  });

  it("respects category options - disabling urls skips url highlight", () => {
    const out = highlightTerminalOutput("see https://example.com", {
      urls: false,
    });
    expect(out).not.toContain(ESC + "[34m");
  });

  it("respects category options - disabling ipAddresses skips IP highlight", () => {
    const out = highlightTerminalOutput("connect to 192.168.1.1", {
      ipAddresses: false,
    });
    expect(out).not.toContain(ESC + "[35m");
  });

  it("respects category options - disabling timestamps skips ISO date highlight", () => {
    const out = highlightTerminalOutput("2024-01-15 something", {
      timestamps: false,
    });
    expect(out).not.toContain(ESC + "[90m");
  });

  it("respects category options - disabling numbers skips port highlight", () => {
    const out = highlightTerminalOutput("listening on port 8080", {
      numbers: false,
    });
    expect(out).not.toContain(ESC + "[96m");
  });
});
