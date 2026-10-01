import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it } from "vitest";
import { TerminalLocalEcho } from "../../../src/frontend/lib/terminal-local-echo";

let terminal: Terminal | undefined;
afterEach(() => terminal?.dispose());

const write = (data: string) =>
  new Promise<void>((resolve) => terminal!.write(data, resolve));

function line() {
  return terminal!.buffer.active.getLine(0)?.translateToString(true);
}

describe("local echo with xterm", () => {
  it("keeps fast typing in order when auto prediction activates with input in flight", async () => {
    terminal = new Terminal({ cols: 80, rows: 5 });
    let now = 0;
    const echo = new TerminalLocalEcho("auto", () => now, 100);
    const input = async (data: string) => {
      for (const character of data) await write(echo.handleInput(character));
    };
    await input("d");
    now = 150;
    await write(echo.handleOutput("d"));
    await input("oc");
    now = 300;
    await write(echo.handleOutput("o"));
    await input("k");
    await write(echo.handleOutput("ck"));
    await input("er ps");
    await write(echo.handleOutput("er ps"));
    expect(line()).toBe("docker ps");
    expect(terminal.buffer.active.cursorX).toBe(9);
  });

  it.each(["abZ", "ab\r\n$ "])(
    "reconciles a matching prefix followed by remote output %j",
    async (output) => {
      terminal = new Terminal({ cols: 80, rows: 5 });
      const echo = new TerminalLocalEcho("on");
      for (const character of "abc") await write(echo.handleInput(character));
      await write(echo.handleOutput(output));
      expect(line()).toBe(output.startsWith("abZ") ? "abZ" : "ab");
      if (output.includes("\n")) {
        expect(terminal.buffer.active.getLine(1)?.translateToString(true)).toBe(
          "$ ",
        );
        expect(terminal.buffer.active.cursorX).toBe(2);
      }
    },
  );
});
