import { describe, expect, it, beforeEach } from "vitest";

import { changeAppLanguage, normalizeLanguageCode } from "../../i18n/i18n";

describe("i18n language handling", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("normalizes persisted desktop language codes", () => {
    expect(normalizeLanguageCode("zh_CN")).toBe("zh-CN");
    expect(normalizeLanguageCode("pt_br")).toBe("pt-BR");
    expect(normalizeLanguageCode("EN-us")).toBe("en");
    expect(normalizeLanguageCode("unknown")).toBe("en");
  });

  it("stores the normalized language after a successful switch", async () => {
    await expect(changeAppLanguage("zh_CN")).resolves.toBe("zh-CN");
    expect(localStorage.getItem("i18nextLng")).toBe("zh-CN");
  });
});
