import i18n, { type BackendModule, type ResourceKey } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enTranslation from "../locales/en.json";

type LocaleModule = { default: ResourceKey };

const localeLoaders = {
  af: () => import("../locales/translated/af_ZA.json"),
  ar: () => import("../locales/translated/ar_SA.json"),
  bn: () => import("../locales/translated/bn_BD.json"),
  bg: () => import("../locales/translated/bg_BG.json"),
  ca: () => import("../locales/translated/ca_ES.json"),
  cs: () => import("../locales/translated/cs_CZ.json"),
  da: () => import("../locales/translated/da_DK.json"),
  de: () => import("../locales/translated/de_DE.json"),
  el: () => import("../locales/translated/el_GR.json"),
  "es-ES": () => import("../locales/translated/es_ES.json"),
  fi: () => import("../locales/translated/fi_FI.json"),
  fr: () => import("../locales/translated/fr_FR.json"),
  he: () => import("../locales/translated/he_IL.json"),
  hi: () => import("../locales/translated/hi_IN.json"),
  hu: () => import("../locales/translated/hu_HU.json"),
  id: () => import("../locales/translated/id_ID.json"),
  it: () => import("../locales/translated/it_IT.json"),
  ja: () => import("../locales/translated/ja_JP.json"),
  ko: () => import("../locales/translated/ko_KR.json"),
  nl: () => import("../locales/translated/nl_NL.json"),
  no: () => import("../locales/translated/no_NO.json"),
  pl: () => import("../locales/translated/pl_PL.json"),
  "pt-PT": () => import("../locales/translated/pt_PT.json"),
  "pt-BR": () => import("../locales/translated/pt_BR.json"),
  ro: () => import("../locales/translated/ro_RO.json"),
  ru: () => import("../locales/translated/ru_RU.json"),
  sr: () => import("../locales/translated/sr_SP.json"),
  "sv-SE": () => import("../locales/translated/sv_SE.json"),
  th: () => import("../locales/translated/th_TH.json"),
  tr: () => import("../locales/translated/tr_TR.json"),
  uk: () => import("../locales/translated/uk_UA.json"),
  vi: () => import("../locales/translated/vi_VN.json"),
  "zh-CN": () => import("../locales/translated/zh_CN.json"),
  "zh-TW": () => import("../locales/translated/zh_TW.json"),
} satisfies Record<string, () => Promise<LocaleModule>>;

const supportedLngs = ["en", ...Object.keys(localeLoaders)];

const localeBackend: BackendModule = {
  type: "backend",
  init: () => {},
  read: (language, _namespace, callback) => {
    if (language === "en") {
      callback(null, enTranslation);
      return;
    }

    const loadLocale = localeLoaders[language];
    if (!loadLocale) {
      callback(new Error(`Unsupported language: ${language}`), false);
      return;
    }

    loadLocale()
      .then((module) => callback(null, module.default))
      .catch((error: unknown) => {
        callback(
          error instanceof Error ? error : new Error(String(error)),
          false,
        );
      });
  },
};

i18n
  .use(localeBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs,
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
    },
    partialBundledLanguages: true,

    interpolation: {
      escapeValue: false,
    },

    react: {
      useSuspense: false,
    },
  });

export default i18n;
