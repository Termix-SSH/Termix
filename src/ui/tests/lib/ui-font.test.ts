import { beforeEach, describe, expect, it } from "vitest";
import { applyUiFont } from "../../lib/theme";

describe("applyUiFont", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty("--font-ui");
  });

  it("applies and persists a readable system font", () => {
    applyUiFont("system-sans");

    expect(document.documentElement.style.getPropertyValue("--font-ui")).toBe(
      "ui-sans-serif, system-ui, sans-serif",
    );
    expect(localStorage.getItem("termix-ui-font")).toBe("system-sans");
  });

  it("falls back to JetBrains Mono for an unknown stored value", () => {
    applyUiFont("unknown" as never);

    expect(localStorage.getItem("termix-ui-font")).toBe("jetbrains-mono");
  });
});
