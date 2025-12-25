import React from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Globe } from "lucide-react";

const languages = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  {
    code: "pt",
    name: "Portuguese",
    nativeName: "Português",
  },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "he", name: "Hebrew", nativeName: "עברית" },
];

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  const handleLanguageChange = (value: string) => {
    i18n.changeLanguage(value);
    localStorage.setItem("i18nextLng", value);
  };

  return (
    <div className="flex items-center gap-2 relative z-[99999]">
      <Globe className="h-4 w-4 text-muted-foreground" />
      <Select value={i18n.language} onValueChange={handleLanguageChange}>
        <SelectTrigger className="w-[120px]">
          <SelectValue placeholder={t("placeholders.language")} />
        </SelectTrigger>
        <SelectContent className="z-[99999]">
          {languages.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              {lang.nativeName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
