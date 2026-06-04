import { describe, it, expect, afterEach } from "vitest";
import { isElectron } from "./electron.js";

const win = window as unknown as Record<string, unknown>;

afterEach(() => {
  delete win.IS_ELECTRON;
  delete win.electronAPI;
});

describe("isElectron", () => {
  it("returns false in a plain browser window", () => {
    expect(isElectron()).toBe(false);
  });

  it("returns true when IS_ELECTRON flag is set", () => {
    win.IS_ELECTRON = true;
    expect(isElectron()).toBe(true);
  });

  it("returns true when electronAPI is present", () => {
    win.electronAPI = {};
    expect(isElectron()).toBe(true);
  });

  it("returns true when electronAPI.isElectron is true", () => {
    win.electronAPI = { isElectron: true };
    expect(isElectron()).toBe(true);
  });
});
