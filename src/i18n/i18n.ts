import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enTranslation from "../locales/en.json";
import zhTranslation from "../locales/zh.json";
import deTranslation from "../locales/de.json";
import ptTranslation from "../locales/pt.json";
import ruTranslation from "../locales/ru.json";
import frTranslation from "../locales/fr.json";
import koTranslation from "../locales/ko.json";
import itTranslation from "../locales/it.json";
import esTranslation from "../locales/es.json";
import hiTranslation from "../locales/hi.json";
import bnTranslation from "../locales/bn.json";
import jaTranslation from "../locales/ja.json";
import viTranslation from "../locales/vi.json";
import trTranslation from "../locales/tr.json";
import heTranslation from "../locales/he.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs: [
      "en",
      "zh",
      "de",
      "pt",
      "ru",
      "fr",
      "ko",
      "it",
      "es",
      "hi",
      "bn",
      "ja",
      "vi",
      "tr",
      "he",
    ],
    fallbackLng: "en",
    debug: false,

    detection: {
      order: ["localStorage", "cookie"],
      caches: ["localStorage", "cookie"],
      lookupLocalStorage: "i18nextLng",
      lookupCookie: "i18nextLng",
      checkWhitelist: true,
    },

    resources: {
      en: {
        translation: enTranslation,
      },
      zh: {
        translation: zhTranslation,
      },
      de: {
        translation: deTranslation,
      },
      pt: {
        translation: ptTranslation,
      },
      ru: {
        translation: ruTranslation,
      },
      fr: {
        translation: frTranslation,
      },
      ko: {
        translation: koTranslation,
      },
      it: {
        translation: itTranslation,
      },
      es: {
        translation: esTranslation,
      },
      hi: {
        translation: hiTranslation,
      },
      bn: {
        translation: bnTranslation,
      },
      ja: {
        translation: jaTranslation,
      },
      vi: {
        translation: viTranslation,
      },
      tr: {
        translation: trTranslation,
      },
      he: {
        translation: heTranslation,
      },
    },

    interpolation: {
      escapeValue: false,
    },

    react: {
      useSuspense: false,
    },
  });

export default i18n;
