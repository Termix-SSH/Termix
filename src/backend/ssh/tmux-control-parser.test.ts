import { describe, it, expect, vi } from "vitest";
import {
  decodeControlModeText,
  createControlModeParser,
  type ControlModeHandlers,
} from "./tmux-control-parser.js";

function makeHandlers(): Required<ControlModeHandlers> {
  return {
    onOutput: vi.fn(),
    onExit: vi.fn(),
    onStructureChange: vi.fn(),
  };
}

describe("decodeControlModeText", () => {
  it("decodes CR/LF octal escapes", () => {
    expect(decodeControlModeText("hello\\015\\012world")).toBe(
      "hello\r\nworld",
    );
  });

  it("decodes ANSI color escape sequences", () => {
    expect(decodeControlModeText("\\033[31mred\\033[0m")).toBe(
      "\x1b[31mred\x1b[0m",
    );
  });

  it("decodes escaped backslashes", () => {
    expect(decodeControlModeText("C:\\\\path\\\\to")).toBe("C:\\path\\to");
  });

  it("decodes multi-byte UTF-8 sequences split into octal bytes", () => {
    // "é" is 0xC3 0xA9 -> \303\251
    expect(decodeControlModeText("caf\\303\\251")).toBe("café");
    // "€" is 0xE2 0x82 0xAC -> \342\202\254
    expect(decodeControlModeText("\\342\\202\\254")).toBe("€");
  });

  it("passes through plain text unchanged", () => {
    expect(decodeControlModeText("ls -la | grep foo")).toBe(
      "ls -la | grep foo",
    );
    expect(decodeControlModeText("")).toBe("");
  });

  it("does not re-interpret literal characters produced by an escape", () => {
    // "\\\\015" is an escaped backslash followed by the literal text "015"
    expect(decodeControlModeText("\\\\015")).toBe("\\015");
  });
});

describe("createControlModeParser", () => {
  it("dispatches %output lines with decoded data", () => {
    const handlers = makeHandlers();
    const parser = createControlModeParser(handlers);

    parser.feed("%output %3 hello\\015\\012\n");

    expect(handlers.onOutput).toHaveBeenCalledTimes(1);
    expect(handlers.onOutput).toHaveBeenCalledWith("%3", "hello\r\n");
  });

  it("keeps spaces in the output data", () => {
    const handlers = makeHandlers();
    const parser = createControlModeParser(handlers);

    parser.feed("%output %12 one two  three\n");

    expect(handlers.onOutput).toHaveBeenCalledWith("%12", "one two  three");
  });

  it("buffers lines split across multiple feed() calls", () => {
    const handlers = makeHandlers();
    const parser = createControlModeParser(handlers);

    parser.feed("%output %3 first ha");
    expect(handlers.onOutput).not.toHaveBeenCalled();

    parser.feed("lf\n%output %3 second\n%out");
    expect(handlers.onOutput).toHaveBeenNthCalledWith(1, "%3", "first half");
    expect(handlers.onOutput).toHaveBeenNthCalledWith(2, "%3", "second");

    parser.feed("put %3 third\n");
    expect(handlers.onOutput).toHaveBeenNthCalledWith(3, "%3", "third");
    expect(handlers.onOutput).toHaveBeenCalledTimes(3);
  });

  it("accepts Buffer chunks", () => {
    const handlers = makeHandlers();
    const parser = createControlModeParser(handlers);

    parser.feed(Buffer.from("%output %1 from-buffer\n", "utf8"));

    expect(handlers.onOutput).toHaveBeenCalledWith("%1", "from-buffer");
  });

  it("swallows %begin/%end command reply blocks", () => {
    const handlers = makeHandlers();
    const parser = createControlModeParser(handlers);

    parser.feed(
      [
        "%begin 1760000000 205 0",
        "0: bash* (1 panes)",
        "%output %9 not-real-output-inside-reply",
        "%end 1760000000 205 0",
        "%output %3 real\n",
      ].join("\n"),
    );

    expect(handlers.onOutput).toHaveBeenCalledTimes(1);
    expect(handlers.onOutput).toHaveBeenCalledWith("%3", "real");
  });

  it("swallows %begin/%error blocks", () => {
    const handlers = makeHandlers();
    const parser = createControlModeParser(handlers);

    parser.feed(
      [
        "%begin 1760000000 206 0",
        "unknown command: nope",
        "%error 1760000000 206 0",
        "%output %3 after-error\n",
      ].join("\n"),
    );

    expect(handlers.onOutput).toHaveBeenCalledTimes(1);
    expect(handlers.onOutput).toHaveBeenCalledWith("%3", "after-error");
  });

  it("dispatches %exit with and without a reason", () => {
    const handlers = makeHandlers();
    const parser = createControlModeParser(handlers);

    parser.feed("%exit\n");
    expect(handlers.onExit).toHaveBeenCalledWith(undefined);

    parser.feed("%exit detached\n");
    expect(handlers.onExit).toHaveBeenLastCalledWith("detached");
    expect(handlers.onExit).toHaveBeenCalledTimes(2);
  });

  it("maps structure notifications to onStructureChange", () => {
    const handlers = makeHandlers();
    const parser = createControlModeParser(handlers);

    parser.feed(
      [
        "%session-changed $1 main",
        "%window-add @5",
        "%window-close @5",
        "%layout-change @1 b25d,80x24,0,0,1",
        "%window-renamed @1 logs\n",
      ].join("\n"),
    );

    expect(handlers.onStructureChange).toHaveBeenCalledTimes(5);
    expect(handlers.onOutput).not.toHaveBeenCalled();
  });

  it("does not crash when onStructureChange is not provided", () => {
    const onOutput = vi.fn();
    const parser = createControlModeParser({ onOutput, onExit: vi.fn() });

    expect(() => parser.feed("%window-add @2\n")).not.toThrow();
    expect(onOutput).not.toHaveBeenCalled();
  });

  it("ignores unknown notifications and blank lines", () => {
    const handlers = makeHandlers();
    const parser = createControlModeParser(handlers);

    parser.feed("%subscription-changed foo\n\n%pause %1\n%output %1 ok\n");

    expect(handlers.onOutput).toHaveBeenCalledTimes(1);
    expect(handlers.onOutput).toHaveBeenCalledWith("%1", "ok");
    expect(handlers.onExit).not.toHaveBeenCalled();
    expect(handlers.onStructureChange).not.toHaveBeenCalled();
  });

  it("strips trailing carriage returns from lines", () => {
    const handlers = makeHandlers();
    const parser = createControlModeParser(handlers);

    parser.feed("%output %2 crlf-line\r\n");

    expect(handlers.onOutput).toHaveBeenCalledWith("%2", "crlf-line");
  });
});
