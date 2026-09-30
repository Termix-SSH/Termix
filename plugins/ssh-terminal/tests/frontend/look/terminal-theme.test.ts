import { describe, expect, it } from "vitest";
import { resolveTermixThemeColors } from "../../../src/frontend/look/terminal-theme";
import { TERMINAL_THEMES } from "../../../src/frontend/look/terminal-themes";

describe("resolveTermixThemeColors", () => {
  it("uses the light selection color with the light UI theme", () => {
    const colors = resolveTermixThemeColors("termix", "light");
    expect(colors.background).toBe("#ffffff");
    expect(colors.selectionBackground).toBe(
      TERMINAL_THEMES.termixLight.colors.selectionBackground,
    );
  });

  it("keeps the dark selection color with dark UI themes", () => {
    const colors = resolveTermixThemeColors("termix", "dracula");
    expect(colors.background).toBe("#282a36");
    expect(colors.selectionBackground).toBe(
      TERMINAL_THEMES.termixDark.colors.selectionBackground,
    );
  });
});
