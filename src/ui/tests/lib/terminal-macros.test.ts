import { describe, expect, it, vi } from "vitest";
import {
  parseTerminalMacros,
  runTerminalMacro,
  type MacroStep,
  type TerminalMacro,
} from "@/lib/terminal-macros";

function macro(steps: MacroStep[]): TerminalMacro {
  return {
    id: "macro-1",
    name: "Test",
    steps,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("terminal macro runner", () => {
  it("runs send, delay, regex wait, condition, and repeat steps", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    let listener = (_data: string) => {};
    const run = runTerminalMacro(
      macro([
        { id: "send", type: "send", text: "status", pressEnter: true },
        {
          id: "wait",
          type: "wait",
          pattern: "READY\\s+42",
          timeoutMs: 1000,
          onTimeout: "stop",
        },
        {
          id: "if",
          type: "if",
          pattern: "READY",
          then: [
            {
              id: "repeat",
              type: "repeat",
              count: 2,
              steps: [
                { id: "ok", type: "send", text: "ok", pressEnter: false },
              ],
            },
          ],
          else: [],
        },
      ]),
      {
        send: (data) => sent.push(data),
        subscribe: (next) => {
          listener = next;
          return () => {};
        },
      },
    );
    await vi.advanceTimersByTimeAsync(1);
    listener("READY 42");
    await run;
    expect(sent).toEqual(["status\r", "ok", "ok"]);
    vi.useRealTimers();
  });

  it("stops when a required regex times out", async () => {
    vi.useFakeTimers();
    const run = runTerminalMacro(
      macro([
        {
          id: "wait",
          type: "wait",
          pattern: "never",
          timeoutMs: 100,
          onTimeout: "stop",
        },
      ]),
      { send: () => {}, subscribe: () => () => {} },
    );
    const rejection = expect(run).rejects.toThrow("Timed out");
    await vi.advanceTimersByTimeAsync(101);
    await rejection;
    vi.useRealTimers();
  });

  it("sanitizes persisted macro bounds and drops unknown steps", () => {
    const parsed = parseTerminalMacros(
      JSON.stringify([
        {
          id: "m",
          name: "Macro",
          steps: [
            { id: "d", type: "delay", milliseconds: 999_999 },
            { id: "r", type: "repeat", count: 1000, steps: [] },
            { id: "bad", type: "execute-javascript", code: "nope" },
          ],
        },
      ]),
    );
    expect(parsed[0].steps).toEqual([
      { id: "d", type: "delay", milliseconds: 300_000 },
      { id: "r", type: "repeat", count: 100, steps: [] },
    ]);
  });
});
