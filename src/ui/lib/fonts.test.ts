import { describe, expect, it } from "vitest";
import { getCjkFontFallback, resolveTerminalFontFamily } from "./fonts";

describe("getCjkFontFallback", () => {
  it("prioritizes Simplified Chinese fonts for zh-CN", () => {
    const stack = getCjkFontFallback("zh-CN");
    expect(stack.indexOf("PingFang SC")).toBeLessThan(
      stack.indexOf("Hiragino Sans"),
    );
    expect(stack.indexOf("Microsoft YaHei")).toBeLessThan(
      stack.indexOf("Malgun Gothic"),
    );
  });

  it("prioritizes Traditional Chinese fonts for zh-TW", () => {
    const stack = getCjkFontFallback("zh-TW");
    expect(stack.startsWith('"PingFang TC"')).toBe(true);
    expect(stack).toContain("Microsoft JhengHei");
  });

  it("prioritizes Japanese fonts for ja", () => {
    const stack = getCjkFontFallback("ja");
    expect(stack.startsWith('"Hiragino Sans"')).toBe(true);
    expect(stack).toContain("Yu Gothic UI");
  });

  it("prioritizes Korean fonts for ko", () => {
    const stack = getCjkFontFallback("ko");
    expect(stack.startsWith('"Apple SD Gothic Neo"')).toBe(true);
    expect(stack).toContain("Malgun Gothic");
  });
});

describe("resolveTerminalFontFamily", () => {
  it("places the primary font before CJK fallbacks", () => {
    const stack = resolveTerminalFontFamily("JetBrains Mono", "zh-CN");
    expect(stack.startsWith('"JetBrains Mono"')).toBe(true);
    expect(stack).toContain("PingFang SC");
    expect(stack.endsWith("monospace")).toBe(true);
  });
});
