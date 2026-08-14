import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { quitApp } = require("../electron/app-quit.cjs") as {
  quitApp: (
    app: { quit: () => void },
    window: { destroy: () => void } | null,
  ) => void;
};

describe("Electron app quit", () => {
  it("destroys the window before quitting so renderer unload guards cannot cancel it", () => {
    const calls: string[] = [];
    quitApp(
      { quit: vi.fn(() => calls.push("quit")) },
      { destroy: vi.fn(() => calls.push("destroy")) },
    );

    expect(calls).toEqual(["destroy", "quit"]);
  });

  it("still quits after the window has already gone", () => {
    const quit = vi.fn();
    quitApp({ quit }, null);
    expect(quit).toHaveBeenCalledOnce();
  });
});
