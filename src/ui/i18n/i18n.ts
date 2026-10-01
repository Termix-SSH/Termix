import i18n, { type BackendModule, type ResourceKey } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enTranslation from "../locales/en.json";

type LocaleModule = { default: ResourceKey };

/** i18n code -> translated file name, shared by core and plugin locales. */
export const LOCALE_FILES = {
  af: "af_ZA",
  ar: "ar_SA",
  bn: "bn_BD",
  bg: "bg_BG",
  ca: "ca_ES",
  cs: "cs_CZ",
  da: "da_DK",
  de: "de_DE",
  el: "el_GR",
  "es-ES": "es_ES",
  fi: "fi_FI",
  fr: "fr_FR",
  he: "he_IL",
  hi: "hi_IN",
  hu: "hu_HU",
  id: "id_ID",
  it: "it_IT",
  ja: "ja_JP",
  ko: "ko_KR",
  nl: "nl_NL",
  no: "no_NO",
  pl: "pl_PL",
  "pt-PT": "pt_PT",
  "pt-BR": "pt_BR",
  ro: "ro_RO",
  ru: "ru_RU",
  sr: "sr_SP",
  "sv-SE": "sv_SE",
  th: "th_TH",
  tr: "tr_TR",
  uk: "uk_UA",
  vi: "vi_VN",
  "zh-CN": "zh_CN",
  "zh-TW": "zh_TW",
} as const satisfies Record<string, string>;

const translatedFiles = import.meta.glob<LocaleModule>(
  "../locales/translated/*.json",
);

const localeLoaders: Record<string, () => Promise<LocaleModule>> =
  Object.fromEntries(
    Object.entries(LOCALE_FILES).map(([code, file]) => [
      code,
      () => {
        const load = translatedFiles[`../locales/translated/${file}.json`];
        return load ? load() : Promise.reject(new Error(`no ${file}`));
      },
    ]),
  );

/**
 * Loads a plugin namespace. Set by the plugin loader; until then a plugin
 * namespace resolves to nothing and keys fall back to core.
 */
export type PluginLocaleResolver = (
  namespace: string,
  language: string,
  file: string,
) => Promise<ResourceKey | null>;

let pluginLocaleResolver: PluginLocaleResolver | null = null;

export function setPluginLocaleResolver(
  resolver: PluginLocaleResolver | null,
): void {
  pluginLocaleResolver = resolver;
}

export const supportedLngs = ["en", ...Object.keys(localeLoaders)];
const PENDING_LOGIN_LANGUAGE_KEY = "termix-pending-login-language";

/** Core strings. Each plugin gets a namespace named after its id. */
export const CORE_NAMESPACE = "translation";

export function normalizeLanguageCode(language?: string | null): string {
  if (!language) return "en";

  const normalized = language.replaceAll("_", "-");
  if (supportedLngs.includes(normalized)) return normalized;

  const exactMatch = supportedLngs.find(
    (supported) => supported.toLowerCase() === normalized.toLowerCase(),
  );
  if (exactMatch) return exactMatch;

  const baseLanguage = normalized.split("-")[0];
  return supportedLngs.includes(baseLanguage) ? baseLanguage : "en";
}

const localeBackend: BackendModule = {
  type: "backend",
  init: () => {},
  read: (language, namespace, callback) => {
    const normalizedLanguage = normalizeLanguageCode(language);

    if (namespace !== CORE_NAMESPACE) {
      const file =
        normalizedLanguage === "en"
          ? "en"
          : (LOCALE_FILES as Record<string, string>)[normalizedLanguage];
      if (!pluginLocaleResolver || !file) {
        callback(null, {});
        return;
      }
      pluginLocaleResolver(namespace, normalizedLanguage, file)
        .then((resources) => callback(null, resources ?? {}))
        .catch(() => callback(null, {}));
      return;
    }

    if (normalizedLanguage === "en") {
      callback(null, enTranslation);
      return;
    }

    const loadLocale = localeLoaders[normalizedLanguage];
    if (!loadLocale) {
      callback(null, enTranslation);
      return;
    }

    loadLocale()
      .then((module) => callback(null, module.default))
      .catch(() => callback(null, enTranslation));
  },
};

i18n
  .use(localeBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs,
    fallbackLng: "en",
    // A plugin's namespace falls back to core, so plugins keep using the
    // shared strings (common.*, hosts.*) without copying them.
    fallbackNS: CORE_NAMESPACE,
    debug: false,

    detection: {
      order: ["localStorage", "cookie"],
      caches: ["localStorage", "cookie"],
      lookupLocalStorage: "i18nextLng",
      lookupCookie: "i18nextLng",
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

export async function changeAppLanguage(language: string): Promise<string> {
  const normalizedLanguage = normalizeLanguageCode(language);
  await i18n.changeLanguage(normalizedLanguage);
  localStorage.setItem("i18nextLng", normalizedLanguage);
  return normalizedLanguage;
}

export function rememberLoginLanguage(language: string): string {
  const normalizedLanguage = normalizeLanguageCode(language);
  sessionStorage.setItem(PENDING_LOGIN_LANGUAGE_KEY, normalizedLanguage);
  return normalizedLanguage;
}

export function consumeLoginLanguage(): string | null {
  const language = sessionStorage.getItem(PENDING_LOGIN_LANGUAGE_KEY);
  sessionStorage.removeItem(PENDING_LOGIN_LANGUAGE_KEY);
  return language ? normalizeLanguageCode(language) : null;
}

export default i18n;
