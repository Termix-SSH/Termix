/** Latin monospace fallbacks when the primary font lacks a glyph. */
export const LATIN_MONO_FALLBACK =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono"';

/** Balanced CJK fallbacks before locale is resolved. */
export const DEFAULT_CJK_FALLBACK =
  '"PingFang SC", "PingFang TC", "Hiragino Sans", "Yu Gothic UI", "Apple SD Gothic Neo", "Malgun Gothic", "Microsoft YaHei", "Microsoft JhengHei"';

function normalizeLocale(locale: string): string {
  return locale.trim().toLowerCase().replace(/_/g, "-");
}

/**
 * Locale-aware CJK font fallbacks. Primary script fonts are listed first so
 * mixed UI text renders with the correct regional typeface.
 */
export function getCjkFontFallback(locale?: string | null): string {
  const lang = normalizeLocale(locale ?? "en");

  if (lang.startsWith("zh-cn") || lang === "zh") {
    return '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", "Hiragino Sans GB", "Yu Gothic UI", "Malgun Gothic"';
  }
  if (
    lang.startsWith("zh-tw") ||
    lang.startsWith("zh-hk") ||
    lang.startsWith("zh-hant")
  ) {
    return '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Source Han Sans TC", "Hiragino Sans", "Yu Gothic UI", "Malgun Gothic"';
  }
  if (lang.startsWith("ja")) {
    return '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", "Meiryo", "Noto Sans JP", "Source Han Sans JP"';
  }
  if (lang.startsWith("ko")) {
    return '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Source Han Sans KR"';
  }

  return DEFAULT_CJK_FALLBACK;
}

export function resolveTerminalFontFamily(
  primaryFont: string,
  locale?: string | null,
): string {
  return `"${primaryFont}", ${LATIN_MONO_FALLBACK}, ${getCjkFontFallback(locale)}, monospace`;
}

export function applyLocaleFonts(locale?: string | null): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--font-cjk",
    getCjkFontFallback(locale),
  );
}
