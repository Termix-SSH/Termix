/* eslint-disable react-refresh/only-export-components */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Input } from "@/components/input";
import { Select2 } from "@/components/select2";
import {
  ACCENT_PRESET_COLORS,
  applyAccentColor,
  applyFontSize,
  applyUiFont,
  FONT_SIZES,
  UI_FONTS,
} from "@/lib/theme";
import { changeAppLanguage, normalizeLanguageCode } from "@/i18n/i18n";
import { getUserPreferences, saveUserPreferences } from "@/api/open-tabs-api";
import type { FontSizeId, ThemeId, UiFontId } from "@/types/ui-types";

export const DEFAULT_ACCENT = "#f59145";

export const THEMES: { id: ThemeId; preview: string }[] = [
  { id: "system", preview: "auto" },
  { id: "light", preview: "#ffffff" },
  { id: "dark", preview: "#1a1c22" },
  { id: "dracula", preview: "#282a36" },
  { id: "catppuccin", preview: "#1e1e2e" },
  { id: "nord", preview: "#2e3440" },
  { id: "solarized", preview: "#002b36" },
  { id: "tokyo-night", preview: "#1a1b26" },
  { id: "one-dark", preview: "#282c34" },
  { id: "gruvbox", preview: "#282828" },
];

/** Background, panel and text colours for the little theme previews. */
const THEME_PALETTES: Record<
  Exclude<ThemeId, "system">,
  { bg: string; panel: string; text: string }
> = {
  light: { bg: "#ffffff", panel: "#eef0f3", text: "#1f2937" },
  dark: { bg: "#1a1c22", panel: "#25272e", text: "#e5e7eb" },
  dracula: { bg: "#282a36", panel: "#44475a", text: "#f8f8f2" },
  catppuccin: { bg: "#1e1e2e", panel: "#313244", text: "#cdd6f4" },
  nord: { bg: "#2e3440", panel: "#3b4252", text: "#eceff4" },
  solarized: { bg: "#002b36", panel: "#073642", text: "#93a1a1" },
  "tokyo-night": { bg: "#1a1b26", panel: "#24283b", text: "#c0caf5" },
  "one-dark": { bg: "#282c34", panel: "#21252b", text: "#abb2bf" },
  gruvbox: { bg: "#282828", panel: "#3c3836", text: "#ebdbb2" },
};

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "af", label: "Afrikaans" },
  { code: "ar", label: "العربية" },
  { code: "bn", label: "বাংলা" },
  { code: "bg", label: "Български" },
  { code: "ca", label: "Català" },
  { code: "zh-CN", label: "中文 (简体)" },
  { code: "zh-TW", label: "中文 (繁體)" },
  { code: "cs", label: "Čeština" },
  { code: "da", label: "Dansk" },
  { code: "nl", label: "Nederlands" },
  { code: "fi", label: "Suomi" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "el", label: "Ελληνικά" },
  { code: "he", label: "עברית" },
  { code: "hi", label: "हिन्दी" },
  { code: "hu", label: "Magyar" },
  { code: "id", label: "Indonesia" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "no", label: "Norsk" },
  { code: "pl", label: "Polski" },
  { code: "pt-PT", label: "Português (PT)" },
  { code: "pt-BR", label: "Português (BR)" },
  { code: "ro", label: "Română" },
  { code: "ru", label: "Русский" },
  { code: "sr", label: "Српски" },
  { code: "es-ES", label: "Español" },
  { code: "sv-SE", label: "Svenska" },
  { code: "th", label: "ไทย" },
  { code: "tr", label: "Türkçe" },
  { code: "uk", label: "Українська" },
  { code: "vi", label: "Tiếng Việt" },
];

export const THEME_LABEL_KEYS: Record<ThemeId, string> = {
  system: "newUi.sidebar.userProfile.themeSystem",
  light: "newUi.sidebar.userProfile.themeLight",
  dark: "newUi.sidebar.userProfile.themeDark",
  dracula: "newUi.sidebar.userProfile.themeDracula",
  catppuccin: "newUi.sidebar.userProfile.themeCatppuccin",
  nord: "newUi.sidebar.userProfile.themeNord",
  solarized: "newUi.sidebar.userProfile.themeSolarized",
  "tokyo-night": "newUi.sidebar.userProfile.themeTokyoNight",
  "one-dark": "newUi.sidebar.userProfile.themeOneDark",
  gruvbox: "newUi.sidebar.userProfile.themeGruvbox",
};

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value) || /^#[0-9a-fA-F]{3}$/.test(value);
}

type CloudPrefs = Parameters<typeof saveUserPreferences>[0];

/** Saves to the account only for users who sync settings to the server. */
async function saveIfCloud(prefs: CloudPrefs): Promise<void> {
  try {
    const current = await getUserPreferences();
    if (current?.storageMode === "cloud") await saveUserPreferences(prefs);
  } catch {
    // The local copy already holds the change.
  }
}

/**
 * Theme, accent, font and language, applied right away and stored the same
 * way the profile settings store them.
 */
export function useAppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const [accent, setAccentState] = useState(
    () => localStorage.getItem("termix-accent") ?? DEFAULT_ACCENT,
  );
  const [fontSize, setFontSizeState] = useState<FontSizeId>(
    () => (localStorage.getItem("termix-font-size") as FontSizeId) ?? "md",
  );
  const [uiFont, setUiFontState] = useState<UiFontId>(
    () =>
      (localStorage.getItem("termix-ui-font") as UiFontId) ?? "jetbrains-mono",
  );
  const [language, setLanguageState] = useState(() =>
    normalizeLanguageCode(localStorage.getItem("i18nextLng")),
  );

  return {
    theme,
    accent,
    fontSize,
    uiFont,
    language,
    setTheme(id: ThemeId) {
      setTheme(id);
      void saveIfCloud({ theme: id });
    },
    setAccent(value: string) {
      setAccentState(value);
      localStorage.setItem("termix-accent", value);
      applyAccentColor(value);
      void saveIfCloud({ accentColor: value });
    },
    setFontSize(id: FontSizeId) {
      setFontSizeState(id);
      applyFontSize(id);
      void saveIfCloud({ fontSize: id });
    },
    setUiFont(id: UiFontId) {
      setUiFontState(id);
      applyUiFont(id);
    },
    setLanguage(code: string) {
      void changeAppLanguage(code)
        .then((next) => {
          setLanguageState(next);
          void saveIfCloud({ language: next });
        })
        .catch(() => {});
    },
  };
}

function ThemePreview({ id }: { id: ThemeId }) {
  if (id === "system") {
    return (
      <div className="flex h-14 w-full">
        <div className="flex-1">
          <MiniWindow {...THEME_PALETTES.light} />
        </div>
        <div className="flex-1">
          <MiniWindow {...THEME_PALETTES.dark} />
        </div>
      </div>
    );
  }
  return (
    <div className="h-14 w-full">
      <MiniWindow {...THEME_PALETTES[id]} />
    </div>
  );
}

function MiniWindow({
  bg,
  panel,
  text,
}: {
  bg: string;
  panel: string;
  text: string;
}) {
  return (
    <div className="flex h-full w-full" style={{ background: bg }}>
      <div
        className="flex w-1/4 flex-col gap-1 p-1"
        style={{ background: panel }}
      >
        <div className="h-1 w-3/4" style={{ background: text, opacity: 0.6 }} />
        <div
          className="h-1 w-1/2"
          style={{ background: text, opacity: 0.35 }}
        />
        <div
          className="h-1 w-2/3"
          style={{ background: text, opacity: 0.35 }}
        />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-1.5">
        <div className="h-1 w-1/2 bg-accent-brand" />
        <div
          className="h-1 w-5/6"
          style={{ background: text, opacity: 0.45 }}
        />
        <div className="h-1 w-2/3" style={{ background: text, opacity: 0.3 }} />
      </div>
    </div>
  );
}

export function ThemeGrid({
  value,
  onChange,
}: {
  value: ThemeId;
  onChange: (id: ThemeId) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {THEMES.map(({ id }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(id)}
            className={`flex flex-col overflow-hidden border text-left transition-colors ${
              active
                ? "border-accent-brand ring-1 ring-accent-brand"
                : "border-border hover:border-foreground/40"
            }`}
          >
            <ThemePreview id={id} />
            <span className="flex items-center justify-between gap-1 border-t border-border bg-card px-2 py-1.5 text-[11px]">
              {t(THEME_LABEL_KEYS[id])}
              {active && <Check size={11} className="text-accent-brand" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function AccentPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const colorInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  const commit = () => {
    const next = draft.trim();
    if (isHexColor(next)) onChange(next);
    else setDraft(value);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
        {ACCENT_PRESET_COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            title={color.label}
            aria-label={color.label}
            aria-pressed={value === color.value}
            onClick={() => onChange(color.value)}
            className="flex h-7 items-center justify-center border border-border"
            style={{ background: color.value }}
          >
            {value === color.value && (
              <Check size={12} className="text-white drop-shadow" />
            )}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 border border-border bg-muted/30 px-2 py-1.5">
        <button
          type="button"
          onClick={() => colorInputRef.current?.click()}
          className="size-5 shrink-0 cursor-pointer border border-border/60"
          style={{ background: value }}
          title={t("newUi.sidebar.userProfile.colorPickerTooltip")}
        />
        <input
          ref={colorInputRef}
          type="color"
          value={
            value.startsWith("#") && value.length === 7 ? value : "#f97316"
          }
          onChange={(e) => onChange(e.target.value)}
          className="sr-only"
        />
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          placeholder="#f97316"
          className="h-6 min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[11px] focus-visible:ring-0"
        />
        <span className="shrink-0 text-[10px] text-muted-foreground">hex</span>
      </div>
    </div>
  );
}

export function FontSizePicker({
  value,
  onChange,
}: {
  value: FontSizeId;
  onChange: (id: FontSizeId) => void;
}) {
  return (
    <div className="flex gap-1">
      {FONT_SIZES.map((size) => (
        <button
          key={size.id}
          type="button"
          aria-pressed={value === size.id}
          onClick={() => onChange(size.id)}
          className={`flex-1 border py-1.5 text-[10px] font-bold transition-colors ${
            value === size.id
              ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {size.label}
        </button>
      ))}
    </div>
  );
}

export function UiFontSelect({
  value,
  onChange,
}: {
  value: UiFontId;
  onChange: (id: UiFontId) => void;
}) {
  return (
    <Select2
      value={value}
      onChange={(e) => onChange(e.target.value as UiFontId)}
      className="w-full border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
    >
      {UI_FONTS.map((font) => (
        <option key={font.id} value={font.id}>
          {font.label}
        </option>
      ))}
    </Select2>
  );
}

export function LanguageSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  return (
    <Select2
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.label}
        </option>
      ))}
    </Select2>
  );
}
