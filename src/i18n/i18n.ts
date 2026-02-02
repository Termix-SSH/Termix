import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enTranslation from "../locales/en.json";
import afTranslation from "../locales/translated/af.json";
import arTranslation from "../locales/translated/ar.json";
import bnTranslation from "../locales/translated/bn.json";
import bgTranslation from "../locales/translated/bg.json";
import caTranslation from "../locales/translated/ca.json";
import csTranslation from "../locales/translated/cs.json";
import daTranslation from "../locales/translated/da.json";
import deTranslation from "../locales/translated/de.json";
import elTranslation from "../locales/translated/el.json";
import esESTranslation from "../locales/translated/es-ES.json";
import fiTranslation from "../locales/translated/fi.json";
import frTranslation from "../locales/translated/fr.json";
import heTranslation from "../locales/translated/he.json";
import hiTranslation from "../locales/translated/hi.json";
import huTranslation from "../locales/translated/hu.json";
import idTranslation from "../locales/translated/id.json";
import itTranslation from "../locales/translated/it.json";
import jaTranslation from "../locales/translated/ja.json";
import koTranslation from "../locales/translated/ko.json";
import nlTranslation from "../locales/translated/nl.json";
import noTranslation from "../locales/translated/no.json";
import plTranslation from "../locales/translated/pl.json";
import ptPTTranslation from "../locales/translated/pt-PT.json";
import ptBRTranslation from "../locales/translated/pt-BR.json";
import roTranslation from "../locales/translated/ro.json";
import ruTranslation from "../locales/translated/ru.json";
import srTranslation from "../locales/translated/sr.json";
import svSETranslation from "../locales/translated/sv-SE.json";
import thTranslation from "../locales/translated/th.json";
import trTranslation from "../locales/translated/tr.json";
import ukTranslation from "../locales/translated/uk.json";
import viTranslation from "../locales/translated/vi.json";
import zhCNTranslation from "../locales/translated/zh-CN.json";
import zhTWTranslation from "../locales/translated/zh-TW.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs: [
      "en",
      "af",
      "ar",
      "bn",
      "bg",
      "ca",
      "cs",
      "da",
      "de",
      "el",
      "es-ES",
      "fi",
      "fr",
      "he",
      "hi",
      "hu",
      "id",
      "it",
      "ja",
      "ko",
      "nl",
      "no",
      "pl",
      "pt-PT",
      "pt-BR",
      "ro",
      "ru",
      "sr",
      "sv-SE",
      "th",
      "tr",
      "uk",
      "vi",
      "zh-CN",
      "zh-TW",
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
      af: {
        translation: afTranslation,
      },
      ar: {
        translation: arTranslation,
      },
      bn: {
        translation: bnTranslation,
      },
      bg: {
        translation: bgTranslation,
      },
      ca: {
        translation: caTranslation,
      },
      cs: {
        translation: csTranslation,
      },
      da: {
        translation: daTranslation,
      },
      de: {
        translation: deTranslation,
      },
      el: {
        translation: elTranslation,
      },
      "es-ES": {
        translation: esESTranslation,
      },
      fi: {
        translation: fiTranslation,
      },
      fr: {
        translation: frTranslation,
      },
      he: {
        translation: heTranslation,
      },
      hi: {
        translation: hiTranslation,
      },
      hu: {
        translation: huTranslation,
      },
      id: {
        translation: idTranslation,
      },
      it: {
        translation: itTranslation,
      },
      ja: {
        translation: jaTranslation,
      },
      ko: {
        translation: koTranslation,
      },
      nl: {
        translation: nlTranslation,
      },
      no: {
        translation: noTranslation,
      },
      pl: {
        translation: plTranslation,
      },
      "pt-PT": {
        translation: ptPTTranslation,
      },
      "pt-BR": {
        translation: ptBRTranslation,
      },
      ro: {
        translation: roTranslation,
      },
      ru: {
        translation: ruTranslation,
      },
      sr: {
        translation: srTranslation,
      },
      "sv-SE": {
        translation: svSETranslation,
      },
      th: {
        translation: thTranslation,
      },
      tr: {
        translation: trTranslation,
      },
      uk: {
        translation: ukTranslation,
      },
      vi: {
        translation: viTranslation,
      },
      "zh-CN": {
        translation: zhCNTranslation,
      },
      "zh-TW": {
        translation: zhTWTranslation,
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
