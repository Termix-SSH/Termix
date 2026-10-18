import { describe, expect, it } from "vitest";
import type { LookResponse } from "@/api/look-api";
import {
  FALLBACK_THEME,
  resolveLayoutId,
  resolveThemeId,
  safeLayoutInUrl,
} from "@/look/resolve-look";

function look(patch: Partial<LookResponse> = {}): LookResponse {
  return {
    layoutId: null,
    themeId: null,
    defaults: { layout: null, theme: null },
    defaultLook: { layout: null, theme: null },
    safeLayout: false,
    unavailable: [],
    ...patch,
  };
}

describe("resolveLayoutId", () => {
  it("prefers the user, then the admin default, then the default look", () => {
    const full = look({
      layoutId: "mine",
      defaults: { layout: "admin", theme: null },
      defaultLook: { layout: "shipped", theme: null },
    });
    expect(resolveLayoutId(full)).toBe("mine");
    expect(resolveLayoutId({ ...full, layoutId: null })).toBe("admin");
    expect(
      resolveLayoutId({
        ...full,
        layoutId: null,
        defaults: { layout: null, theme: null },
      }),
    ).toBe("shipped");
    expect(resolveLayoutId(look())).toBe("");
  });

  it("falls back to the last layout shown when the server did not answer", () => {
    expect(resolveLayoutId(null, "remembered")).toBe("remembered");
    expect(resolveLayoutId(null)).toBe("");
  });
});

describe("resolveThemeId", () => {
  it("keeps today's per-browser theme ahead of the defaults", () => {
    const defaults = look({
      defaults: { layout: null, theme: "admin" },
      defaultLook: { layout: null, theme: "shipped" },
    });
    expect(resolveThemeId(defaults, "local")).toBe("local");
    expect(resolveThemeId({ ...defaults, themeId: "mine" }, "local")).toBe(
      "mine",
    );
    expect(resolveThemeId(defaults, null, "layout")).toBe("admin");
    expect(
      resolveThemeId(
        { ...defaults, defaults: { layout: null, theme: null } },
        null,
        "layout",
      ),
    ).toBe("layout");
    expect(
      resolveThemeId(
        { ...defaults, defaults: { layout: null, theme: null } },
        null,
      ),
    ).toBe("shipped");
    expect(resolveThemeId(null, null)).toBe(FALLBACK_THEME);
  });
});

describe("safeLayoutInUrl", () => {
  it("reads ?safe-layout=1", () => {
    expect(safeLayoutInUrl("?safe-layout=1")).toBe(true);
    expect(safeLayoutInUrl("?x=1&safe-layout=true")).toBe(true);
    expect(safeLayoutInUrl("?safe-layout=0")).toBe(false);
    expect(safeLayoutInUrl("")).toBe(false);
  });
});
