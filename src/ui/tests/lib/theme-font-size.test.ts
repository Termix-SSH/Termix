import { afterEach, describe, expect, it, vi } from "vitest";
import { applyFontSize } from "@/lib/theme";

type ElectronWindow = { electronAPI?: unknown };

afterEach(() => {
  delete (window as unknown as ElectronWindow).electronAPI;
  document.documentElement.className = "";
  localStorage.clear();
});

describe("interface size", () => {
  it("sets the root size class and remembers it", () => {
    applyFontSize("lg");
    expect(document.documentElement.classList.contains("fs-lg")).toBe(true);
    applyFontSize("sm");
    expect(document.documentElement.className).toBe("fs-sm");
    expect(localStorage.getItem("termix-font-size")).toBe("sm");
  });

  it("takes back the window zoom an earlier desktop build set", () => {
    const setZoomFactor = vi.fn();
    (window as unknown as ElectronWindow).electronAPI = { setZoomFactor };
    applyFontSize("xl");
    expect(setZoomFactor).toHaveBeenCalledWith(1);
    expect(document.documentElement.classList.contains("fs-xl")).toBe(true);
  });

  it("falls back to Normal for an unknown size", () => {
    applyFontSize("huge" as never);
    expect(document.documentElement.classList.contains("fs-md")).toBe(true);
    expect(localStorage.getItem("termix-font-size")).toBe("md");
  });
});
