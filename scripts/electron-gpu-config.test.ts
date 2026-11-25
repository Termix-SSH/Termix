import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  GPU_CRASH_FALLBACK_THRESHOLD,
  shouldDisableHardwareAcceleration,
  createGpuCrashTracker,
} = require("../electron/gpu-config.cjs") as {
  GPU_CRASH_FALLBACK_THRESHOLD: number;
  shouldDisableHardwareAcceleration: (options?: {
    platform?: string;
    env?: Record<string, string | undefined>;
    settings?: { disableHardwareAcceleration?: boolean };
  }) => boolean;
  createGpuCrashTracker: (options?: {
    threshold?: number;
    onThresholdReached?: (
      details: { type: string; reason: string; exitCode?: number },
      count: number,
    ) => void;
    log?: (...args: unknown[]) => void;
  }) => {
    handleChildProcessGone: (details: {
      type: string;
      reason: string;
      exitCode?: number;
    }) => boolean;
    getCrashCount: () => number;
  };
};

describe("Electron GPU startup policy", () => {
  it.each([
    ["win32", {}, {}, false],
    ["linux", {}, {}, false],
    ["darwin", {}, {}, false],
    ["win32", { ELECTRON_DISABLE_GPU: "0" }, {}, false],
    ["linux", { ELECTRON_DISABLE_GPU: "0" }, {}, false],
    ["win32", { ELECTRON_DISABLE_GPU: "1" }, {}, true],
    ["linux", { ELECTRON_DISABLE_GPU: "1" }, {}, true],
    ["darwin", { ELECTRON_DISABLE_GPU: "1" }, {}, true],
    ["win32", {}, { disableHardwareAcceleration: true }, true],
    [
      "win32",
      { ELECTRON_DISABLE_GPU: "0" },
      { disableHardwareAcceleration: true },
      true,
    ],
    ["win32", {}, { disableHardwareAcceleration: false }, false],
  ])(
    "evaluates hardware acceleration on %s with env %j and settings %j",
    (platform, env, settings, expected) => {
      expect(
        shouldDisableHardwareAcceleration({ platform, env, settings }),
      ).toBe(expected);
    },
  );

  it("wires GPU startup policy and crash fallback in electron/main.cjs", () => {
    const main = readFileSync(
      new URL("../electron/main.cjs", import.meta.url),
      "utf8",
    );
    expect(main).toContain("shouldDisableHardwareAcceleration(");
    expect(main).toContain("app.disableHardwareAcceleration()");
    expect(main).toContain('app.on("child-process-gone"');
    expect(main).toContain("disableHardwareAcceleration: true");
    expect(main).not.toMatch(
      /process\.platform\s*===\s*["']win32["'][^;\n]*ELECTRON_DISABLE_GPU/,
    );
  });
});

describe("GPU crash fallback tracker", () => {
  it("ignores non-GPU processes and clean GPU exits", () => {
    const onThresholdReached = vi.fn();
    const tracker = createGpuCrashTracker({ onThresholdReached });

    expect(
      tracker.handleChildProcessGone({ type: "Utility", reason: "crashed" }),
    ).toBe(false);
    expect(tracker.handleChildProcessGone({ type: "Tab", reason: "oom" })).toBe(
      false,
    );
    expect(
      tracker.handleChildProcessGone({ type: "GPU", reason: "clean-exit" }),
    ).toBe(false);

    expect(tracker.getCrashCount()).toBe(0);
    expect(onThresholdReached).not.toHaveBeenCalled();
  });

  it("triggers software-rendering fallback once after reaching the crash threshold", () => {
    const onThresholdReached = vi.fn();
    const log = vi.fn();
    const tracker = createGpuCrashTracker({ onThresholdReached, log });

    expect(GPU_CRASH_FALLBACK_THRESHOLD).toBe(3);

    expect(
      tracker.handleChildProcessGone({
        type: "GPU",
        reason: "crashed",
        exitCode: -1073741819,
      }),
    ).toBe(false);
    expect(
      tracker.handleChildProcessGone({
        type: "GPU",
        reason: "abnormal-exit",
        exitCode: 1,
      }),
    ).toBe(false);
    expect(onThresholdReached).not.toHaveBeenCalled();

    const thirdCrash = { type: "GPU", reason: "crashed", exitCode: 1 };
    expect(tracker.handleChildProcessGone(thirdCrash)).toBe(true);
    expect(tracker.getCrashCount()).toBe(3);
    expect(onThresholdReached).toHaveBeenCalledTimes(1);
    expect(onThresholdReached).toHaveBeenCalledWith(thirdCrash, 3);

    // Further crashes do not repeatedly rewrite desktop settings.
    expect(
      tracker.handleChildProcessGone({
        type: "GPU",
        reason: "crashed",
        exitCode: 1,
      }),
    ).toBe(false);
    expect(tracker.getCrashCount()).toBe(4);
    expect(onThresholdReached).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(4);
  });
});
