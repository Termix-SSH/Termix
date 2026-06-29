import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import type {
  SearchBarConfig,
  SearchEngine,
  WidgetEditFormProps,
} from "@/types/homepage-types";

const ENGINES: { id: SearchEngine; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "duckduckgo", label: "DuckDuckGo" },
  { id: "bing", label: "Bing" },
  { id: "custom", label: "Custom" },
];

export function SearchBarEditForm({
  config,
  onChange,
}: WidgetEditFormProps<SearchBarConfig>) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.searchEngine")}
        </label>
        <div className="flex flex-wrap gap-1">
          {ENGINES.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onChange({ ...config, engine: e.id })}
              className={`px-2 py-0.5 text-[10px] border transition-colors ${config.engine === e.id ? "bg-accent-brand border-accent-brand text-white" : "border-border text-muted-foreground"}`}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      {config.engine === "custom" && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            {t("homepage.customSearchUrl")}
          </label>
          <Input
            value={config.customUrl ?? ""}
            onChange={(e) => onChange({ ...config, customUrl: e.target.value })}
            placeholder="https://example.com/search?q={q}"
            className="h-8 text-xs"
          />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.searchPlaceholderLabel")}
        </label>
        <Input
          value={config.placeholder ?? ""}
          onChange={(e) =>
            onChange({ ...config, placeholder: e.target.value || undefined })
          }
          placeholder={t("homepage.searchPlaceholderHint")}
          className="h-8 text-xs"
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.openInNewTab}
          onChange={(e) =>
            onChange({ ...config, openInNewTab: e.target.checked })
          }
          className="accent-accent-brand"
        />
        {t("homepage.openInNewTab")}
      </label>
    </div>
  );
}
