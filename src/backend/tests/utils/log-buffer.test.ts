import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installConsoleCapture,
  readLogLines,
  recordLogLine,
  resetLogBuffer,
  withoutCapture,
} from "../../utils/log-buffer.js";
import { authLogger, pluginLogger } from "../../utils/logger.js";

beforeEach(() => resetLogBuffer());

describe("log buffer", () => {
  it("keeps the first lines apart from the recent ones", () => {
    for (let i = 0; i < 5000; i++) {
      recordLogLine({ level: "info", service: "T", text: `line ${i}` });
    }
    const { boot, recent, latest, droppedBefore } = readLogLines();
    expect(boot).toHaveLength(400);
    expect(boot[0].text).toBe("line 0");
    expect(recent.length).toBeLessThanOrEqual(4000);
    expect(recent.at(-1)?.text).toBe("line 4999");
    expect(latest).toBe(5000);
    expect(droppedBefore).toBeGreaterThan(400);
  });

  it("strips colors, cuts long lines and masks secrets", () => {
    recordLogLine({
      level: "warn",
      service: "T",
      text: `\u001b[31mred\u001b[0m Bearer abc.def ${"x".repeat(5000)}`,
    });
    const [line] = readLogLines().boot;
    expect(line.text.startsWith("red Bearer [MASKED]")).toBe(true);
    expect(line.text.endsWith("...(cut)")).toBe(true);
  });

  it("finds the plugin a line belongs to", () => {
    recordLogLine({ level: "info", service: "P", text: "Plugin ai: ready" });
    recordLogLine({
      level: "info",
      service: "P",
      text: "Docker mounted",
      operation: "plugin:docker",
    });
    expect(readLogLines({ pluginId: "ai" }).boot).toHaveLength(1);
    expect(readLogLines({ pluginId: "docker" }).boot[0].text).toBe(
      "Docker mounted",
    );
  });

  it("filters by seq, level and limit", () => {
    recordLogLine({ level: "info", service: "T", text: "a" });
    recordLogLine({ level: "error", service: "T", text: "b" });
    recordLogLine({ level: "warn", service: "T", text: "c" });
    expect(readLogLines({ after: 1 }).boot.map((l) => l.text)).toEqual([
      "b",
      "c",
    ]);
    expect(readLogLines({ levels: ["error"] }).boot.map((l) => l.text)).toEqual(
      ["b"],
    );
  });
});

describe("console capture", () => {
  let restore: () => void;
  let spy: ReturnType<typeof vi.fn>;
  let original: typeof console.warn;

  beforeEach(() => {
    original = console.warn;
    spy = vi.fn();
    console.warn = spy as unknown as typeof console.warn;
    restore = installConsoleCapture();
  });

  afterEach(() => {
    restore();
    console.warn = original;
  });

  it("records console lines and still prints them", () => {
    console.warn("from a library %d", 7);
    expect(spy).toHaveBeenCalledWith("from a library %d", 7);
    const [line] = readLogLines().boot;
    expect(line).toMatchObject({
      level: "warn",
      service: "CONSOLE",
      text: "from a library 7",
    });
  });

  it("skips lines that were already recorded", () => {
    withoutCapture(() => console.warn("twice"));
    expect(readLogLines().boot).toHaveLength(0);
  });

  it("records logger lines once", () => {
    pluginLogger.warn("Plugin alerts: slow start", { operation: "x" });
    const lines = readLogLines().boot;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ service: "PLUGIN", pluginId: "alerts" });
  });
});

describe("private lines", () => {
  it("prints a private line but never keeps it", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    authLogger.info("Password reset code generated for user bob: 123456", {
      private: true,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("123456");
    expect(readLogLines().boot).toHaveLength(0);
    spy.mockRestore();
  });

  it("keeps the error with an error line, masked", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    authLogger.error("Boom happened", new Error("token=abc123 failed"));
    const [line] = readLogLines().boot;
    expect(line.level).toBe("error");
    expect(line.text).toContain("Boom happened");
    expect(line.text).toContain("token=[MASKED]");
    expect(line.text).not.toContain("abc123");
    spy.mockRestore();
  });
});
