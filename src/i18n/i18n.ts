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
import arTranslation from "../locales/ar.json";
import plTranslation from "../locales/pl.json";
import nlTranslation from "../locales/nl.json";
import svTranslation from "../locales/sv.json";
import idTranslation from "../locales/id.json";
import thTranslation from "../locales/th.json";
import ukTranslation from "../locales/uk.json";
import csTranslation from "../locales/cs.json";
import roTranslation from "../locales/ro.json";
import elTranslation from "../locales/el.json";

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
      "ar",
      "pl",
      "nl",
      "sv",
      "id",
      "th",
      "uk",
      "cs",
      "ro",
      "el",
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
      ar: {
        translation: arTranslation,
      },
      pl: {
        translation: plTranslation,
      },
      nl: {
        translation: nlTranslation,
      },
      sv: {
        translation: svTranslation,
      },
      id: {
        translation: idTranslation,
      },
      th: {
        translation: thTranslation,
      },
      uk: {
        translation: ukTranslation,
      },
      cs: {
        translation: csTranslation,
      },
      ro: {
        translation: roTranslation,
      },
      el: {
        translation: elTranslation,
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
