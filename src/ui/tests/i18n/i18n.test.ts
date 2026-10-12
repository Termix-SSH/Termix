import { describe, expect, it, beforeEach } from "vitest";

import {
  changeAppLanguage,
  consumeLoginLanguage,
  LOCALE_FILES,
  normalizeLanguageCode,
  rememberLoginLanguage,
} from "../../i18n/i18n";
import { LANGUAGES, TRANSLATED_LANGUAGES } from "../../i18n/languages";

describe("i18n language handling", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("normalizes persisted desktop language codes", () => {
    expect(normalizeLanguageCode("zh_CN")).toBe("zh-CN");
    expect(normalizeLanguageCode("pt_br")).toBe("pt-BR");
    expect(normalizeLanguageCode("EN-us")).toBe("en");
    expect(normalizeLanguageCode("unknown")).toBe("en");
  });

  it("maps regional variants to the closest shipped language", () => {
    expect(normalizeLanguageCode("es-MX")).toBe("es-ES");
    expect(normalizeLanguageCode("es")).toBe("es-ES");
    expect(normalizeLanguageCode("sv")).toBe("sv-SE");
    expect(normalizeLanguageCode("pt")).toBe("pt-BR");
    expect(normalizeLanguageCode("pt-AO")).toBe("pt-BR");
    expect(normalizeLanguageCode("zh")).toBe("zh-CN");
    expect(normalizeLanguageCode("zh-HK")).toBe("zh-TW");
    expect(normalizeLanguageCode("zh-Hant-TW")).toBe("zh-TW");
    expect(normalizeLanguageCode("nb-NO")).toBe("no");
    expect(normalizeLanguageCode("de-AT")).toBe("de");
    expect(normalizeLanguageCode("sk-SK")).toBe("sk");
  });

  it("ships a translated file for every listed language", () => {
    const files = new Set(
      Object.keys(import.meta.glob("../../locales/translated/*.json")).map(
        (path) => path.split("/").pop()?.replace(".json", ""),
      ),
    );
    for (const language of TRANSLATED_LANGUAGES) {
      expect(LOCALE_FILES[language.code]).toBe(language.file);
      expect(files.has(language.file), language.file).toBe(true);
    }
    expect(LANGUAGES[0]).toEqual({ code: "en", label: "English" });
    expect(LANGUAGES).toHaveLength(TRANSLATED_LANGUAGES.length + 1);
  });

  it("stores the normalized language after a successful switch", async () => {
    await expect(changeAppLanguage("zh_CN")).resolves.toBe("zh-CN");
    expect(localStorage.getItem("i18nextLng")).toBe("zh-CN");
  });

  it("keeps an explicit login language until preferences are hydrated", () => {
    expect(rememberLoginLanguage("zh_CN")).toBe("zh-CN");
    expect(consumeLoginLanguage()).toBe("zh-CN");
    expect(consumeLoginLanguage()).toBeNull();
  });
});
