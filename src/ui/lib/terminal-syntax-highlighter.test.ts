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

  it("skips private TUI mode sequences", () => {
    const tuiFrame = `${ESC}[?1049h${ESC}[?25lERROR at /var/log/app.log`;
    expect(highlightTerminalOutput(tuiFrame)).toBe(tuiFrame);
  });

  it("skips bracketed paste mode sequences", () => {
    const chunk = `${ESC}[?2004hERROR: enabled paste mode`;
    expect(highlightTerminalOutput(chunk)).toBe(chunk);
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
    const text = "some output\nERROR: failed\n";
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

  it("skips highlighting when chunk contains a mid-line carriage return", () => {
    // Progress bars and shell prompt redraws use \r to overwrite the current line
    const chunk = "downloading...\rdownloading [====] 100%";
    expect(highlightTerminalOutput(chunk)).toBe(chunk);
  });

  it("still processes CRLF line endings (\\r\\n is fine)", () => {
    const out = highlightTerminalOutput("ERROR occurred\r\n");
    expect(out).toContain(ESC + "[91m");
  });

  it("does not highlight shell prompt lines (user@host:path$)", () => {
    const prompt = `${ESC}[01;32mpi@raspberrypi${ESC}[00m:${ESC}[01;34m/home/pi${ESC}[00m$ `;
    const out = highlightTerminalOutput(prompt);
    expect(out).toBe(prompt);
  });

  it("does not highlight plain-text shell prompt line", () => {
    const prompt = "pi@raspberrypi:/home/pi$ ";
    const out = highlightTerminalOutput(prompt);
    expect(out).toBe(prompt);
  });

  it("does not highlight log keywords inside bracketed SSH headings", () => {
    const out = highlightTerminalOutput("[info@archlinux] command output");
    expect(out).toBe("[info@archlinux] command output");
  });

  it("still highlights log keywords after a bracketed SSH heading", () => {
    const out = highlightTerminalOutput("[warning@host] command ERROR");
    expect(out).not.toContain(`${ESC}[93mwarning`);
    expect(out).toContain(`${ESC}[91mERROR`);
  });

  it("does not highlight 'success' when immediately followed by a path (cd output)", () => {
    // Some shells print "success~/new/dir" or "success/path" after a cd command
    const out = highlightTerminalOutput("success~/home/user/projects");
    expect(out).not.toContain(ESC + "[92m");
  });

  it("still highlights 'success' when not followed by a path separator", () => {
    const out = highlightTerminalOutput("Build success: all tests passed");
    expect(out).toContain(ESC + "[92m");
  });

  it("highlights output lines but not the prompt in a mixed chunk", () => {
    const chunk = `ERROR: disk full\npi@raspberrypi:~$ `;
    const out = highlightTerminalOutput(chunk);
    // The error line should be highlighted
    expect(out).toContain(ESC + "[91m");
    // The prompt line should be unchanged
    expect(out).toContain("pi@raspberrypi:~$ ");
    const promptLine = out.split("\n")[1];
    expect(promptLine).toBe("pi@raspberrypi:~$ ");
  });

  it("does not highlight paths inside a command-echo line (prompt + command)", () => {
    // When the shell echoes the user's command, it prefixes the prompt.
    // The path in the prompt portion (/home/user) must not be highlighted —
    // the shell already colored it, and re-coloring it causes the doubled-path bug.
    const echo = "user@host:/home/user$ cd /opt/app/bin/files";
    const out = highlightTerminalOutput(echo);
    expect(out).toBe(echo);
  });

  it("does not highlight paths in colored command-echo lines (root prompt)", () => {
    const echo = `${ESC}[01;32mroot@host${ESC}[00m:${ESC}[01;34m/home/user${ESC}[00m# cd /opt/app/bin/files`;
    const out = highlightTerminalOutput(echo);
    expect(out).toBe(echo);
  });

  it("does not highlight the last line of a multi-line chunk with no trailing newline", () => {
    // In a multi-line chunk, the trailing fragment without \n could be a live
    // readline input line. Injecting ANSI bytes there breaks bash's cursor
    // arithmetic (causes cursor jump / text shift when using arrow keys).
    const chunk = "ERROR: disk full\nuser@host:/path$ cd /var/log";
    const out = highlightTerminalOutput(chunk);
    // First line (terminated by \n) gets highlighted
    expect(out.split("\n")[0]).toContain(ESC + "[91m");
    // Last unterminated fragment is left verbatim
    expect(out.split("\n")[1]).toBe("user@host:/path$ cd /var/log");
  });

  it("still highlights a single-line chunk with no trailing newline", () => {
    // A single-line chunk with no \n is plain command output, not a readline
    // input fragment — highlight it normally.
    const out = highlightTerminalOutput("ERROR: something failed");
    expect(out).toContain(ESC + "[91m");
  });

  it("highlights all lines when the chunk ends with a newline", () => {
    // When a chunk ends with \n every line is complete output — highlight them all.
    const chunk = "ERROR: disk full\nconnect to /var/run/app.sock\n";
    const out = highlightTerminalOutput(chunk);
    expect(out.split("\n")[0]).toContain(ESC + "[91m");
    expect(out.split("\n")[1]).toContain(ESC + "[36m");
  });
});
