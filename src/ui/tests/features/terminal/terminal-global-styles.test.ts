import { describe, expect, it, vi } from "vitest";
import { ensureTerminalFontsLoaded } from "../../../features/terminal/terminal-global-styles";

describe("ensureTerminalFontsLoaded", () => {
  it("requests regular, bold, italic, and bold-italic variants for the given font", () => {
    const load = vi.fn().mockResolvedValue([]);
    const originalFonts = document.fonts;
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load },
    });

    try {
      ensureTerminalFontsLoaded("Caskaydia Cove Nerd Font Mono");

      expect(load).toHaveBeenCalledWith(
        '400 16px "Caskaydia Cove Nerd Font Mono"',
      );
      expect(load).toHaveBeenCalledWith(
        '700 16px "Caskaydia Cove Nerd Font Mono"',
      );
      expect(load).toHaveBeenCalledWith(
        'italic 400 16px "Caskaydia Cove Nerd Font Mono"',
      );
      expect(load).toHaveBeenCalledWith(
        'italic 700 16px "Caskaydia Cove Nerd Font Mono"',
      );
      expect(load).toHaveBeenCalledTimes(4);
    } finally {
      Object.defineProperty(document, "fonts", {
        configurable: true,
        value: originalFonts,
      });
    }
  });

  it("does not throw when document.fonts is unavailable", () => {
    const originalFonts = document.fonts;
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: undefined,
    });

    try {
      expect(() => ensureTerminalFontsLoaded("JetBrains Mono")).not.toThrow();
    } finally {
      Object.defineProperty(document, "fonts", {
        configurable: true,
        value: originalFonts,
      });
    }
  });

  it("swallows rejected font load promises", async () => {
    const load = vi.fn().mockRejectedValue(new Error("network error"));
    const originalFonts = document.fonts;
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load },
    });

    try {
      expect(() => ensureTerminalFontsLoaded("Fira Code")).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      Object.defineProperty(document, "fonts", {
        configurable: true,
        value: originalFonts,
      });
    }
  });
});
