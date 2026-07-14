import { afterEach, describe, expect, it } from "vitest";
import { installElectronWheelZoomGuard } from "./electron-wheel-zoom";

const win = window as unknown as Record<string, unknown>;
let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  delete win.IS_ELECTRON;
  delete win.electronAPI;
});

function dispatchWheel(init?: WheelEventInit): WheelEvent {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  window.dispatchEvent(event);
  return event;
}

describe("installElectronWheelZoomGuard", () => {
  it("does not block ordinary browser wheel events", () => {
    cleanup = installElectronWheelZoomGuard();

    expect(dispatchWheel({ ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("blocks modifier wheel zoom in Electron", () => {
    win.electronAPI = { isElectron: true };
    cleanup = installElectronWheelZoomGuard();

    expect(dispatchWheel({ metaKey: true }).defaultPrevented).toBe(true);
    expect(dispatchWheel({ ctrlKey: true }).defaultPrevented).toBe(true);
    expect(dispatchWheel().defaultPrevented).toBe(false);
  });
});
