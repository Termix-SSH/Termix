import { describe, expect, it } from "vitest";
import { TerminalLocalEcho, resolveLocalEchoMode } from "./terminal-local-echo";

describe("TerminalLocalEcho", () => {
  it("renders immediately and suppresses the matching remote echo", () => {
    const echo = new TerminalLocalEcho("on");
    expect(echo.handleInput("a")).toBe("a");
    expect(echo.handleOutput("a")).toBe("");
  });

  it("rolls back a prediction when remote output differs", () => {
    const echo = new TerminalLocalEcho("on");
    echo.handleInput("a");
    expect(echo.handleOutput("z")).toBe("\x1b[1D\x1b[Kz");
  });

  it("does not expose password input", () => {
    const echo = new TerminalLocalEcho("on");
    expect(echo.handleOutput("Pass")).toBe("Pass");
    expect(echo.handleOutput("word: ")).toBe("word: ");
    expect(echo.handleInput("s")).toBe("");
  });

  it("does not predict control input, paste, or wide characters", () => {
    const echo = new TerminalLocalEcho("on");
    expect(echo.handleInput("\t")).toBe("");
    expect(echo.handleInput("paste")).toBe("");
    expect(echo.handleInput("界")).toBe("");
  });

  it("enables automatic prediction after repeated slow echoes", () => {
    let now = 0;
    const echo = new TerminalLocalEcho("auto", () => now, 100);
    expect(echo.handleInput("a")).toBe("");
    now = 150;
    expect(echo.handleOutput("a")).toBe("a");
    expect(echo.handleInput("b")).toBe("");
    now = 300;
    expect(echo.handleOutput("b")).toBe("b");
    expect(echo.handleInput("c")).toBe("c");
  });

  it("uses an explicit host mode before the global mode", () => {
    expect(resolveLocalEchoMode("off", "on")).toBe("off");
    expect(resolveLocalEchoMode("default", "on")).toBe("on");
    expect(resolveLocalEchoMode(undefined, null)).toBe("auto");
  });
});
