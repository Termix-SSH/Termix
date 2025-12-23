import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enTranslation from "../locales/en/translation.json";
import zhTranslation from "../locales/zh/translation.json";
import deTranslation from "../locales/de/translation.json";
import ptbrTranslation from "../locales/pt-BR/translation.json";
import ruTranslation from "../locales/ru/translation.json";
import frTranslation from "../locales/fr/translation.json";
import koTranslation from "../locales/ko/translation.json";
import itTranslation from "../locales/it/translation.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs: ["en", "zh", "de", "ptbr", "ru", "fr", "ko", "it"],
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
      ptbr: {
        translation: ptbrTranslation,
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
    },

    interpolation: {
      escapeValue: false,
    },

    react: {
      useSuspense: false,
    },
  });

export default i18n;
