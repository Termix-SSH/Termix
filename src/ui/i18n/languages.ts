import languages from "../locales/languages.json";

/** One translated language. The translator in Termix-Registry keeps a copy of this list. */
export interface Language {
  code: string;
  file: string;
  name: string;
  label: string;
}

export const TRANSLATED_LANGUAGES: readonly Language[] = languages;

/** Every language the app can show, English first, for language pickers. */
export const LANGUAGES: readonly { code: string; label: string }[] = [
  { code: "en", label: "English" },
  ...TRANSLATED_LANGUAGES.map(({ code, label }) => ({ code, label })),
];
