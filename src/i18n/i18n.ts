import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enTranslation from "../locales/en.json";
import afTranslation from "../locales/translated/af_ZA.json";
import arTranslation from "../locales/translated/ar_SA.json";
import bnTranslation from "../locales/translated/bn_BD.json";
import bgTranslation from "../locales/translated/bg_BG.json";
import caTranslation from "../locales/translated/ca_ES.json";
import csTranslation from "../locales/translated/cs_CZ.json";
import daTranslation from "../locales/translated/da_DK.json";
import deTranslation from "../locales/translated/de_DE.json";
import elTranslation from "../locales/translated/el_GR.json";
import esESTranslation from "../locales/translated/es_ES.json";
import fiTranslation from "../locales/translated/fi_FI.json";
import frTranslation from "../locales/translated/fr_FR.json";
import heTranslation from "../locales/translated/he_IL.json";
import hiTranslation from "../locales/translated/hi_IN.json";
import huTranslation from "../locales/translated/hu_HU.json";
import idTranslation from "../locales/translated/id_ID.json";
import itTranslation from "../locales/translated/it_IT.json";
import jaTranslation from "../locales/translated/ja_JP.json";
import koTranslation from "../locales/translated/ko_KR.json";
import nlTranslation from "../locales/translated/nl_NL.json";
import noTranslation from "../locales/translated/no_NO.json";
import plTranslation from "../locales/translated/pl_PL.json";
import ptPTTranslation from "../locales/translated/pt_PT.json";
import ptBRTranslation from "../locales/translated/pt_BR.json";
import roTranslation from "../locales/translated/ro_RO.json";
import ruTranslation from "../locales/translated/ru_RU.json";
import srTranslation from "../locales/translated/sr_SP.json";
import svSETranslation from "../locales/translated/sv_SE.json";
import thTranslation from "../locales/translated/th_TH.json";
import trTranslation from "../locales/translated/tr_TR.json";
import ukTranslation from "../locales/translated/uk_UA.json";
import viTranslation from "../locales/translated/vi_VN.json";
import zhCNTranslation from "../locales/translated/zh_CN.json";
import zhTWTranslation from "../locales/translated/zh_TW.json";

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
