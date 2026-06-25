import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  SearchBarConfig,
  SearchEngine,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { WidgetTitle } from "./WidgetTitle";

const ENGINE_URLS: Record<SearchEngine, string> = {
  google: "https://www.google.com/search?q={q}",
  duckduckgo: "https://duckduckgo.com/?q={q}",
  bing: "https://www.bing.com/search?q={q}",
  custom: "",
};

const ENGINE_LABELS: Record<SearchEngine, string> = {
  google: "Google",
  duckduckgo: "DuckDuckGo",
  bing: "Bing",
  custom: "Custom",
};

function buildUrl(
  engine: SearchEngine,
  customUrl: string | undefined,
  query: string,
): string {
  const template =
    engine === "custom" ? (customUrl ?? "") : ENGINE_URLS[engine];
  return template.replace("{q}", encodeURIComponent(query));
}

function SearchBarWidget({
  widget,
  config,
  isReadOnly,
}: WidgetComponentProps<SearchBarConfig>) {
  const { t } = useTranslation();
  const { engine, customUrl, placeholder, openInNewTab } = config;
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    const url = buildUrl(engine, customUrl, query.trim());
    if (!url) return;
    if (openInNewTab) window.open(url, "_blank", "noopener,noreferrer");
    else window.location.href = url;
    setQuery("");
  };

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<Search size={11} />} />
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-1.5 flex-1 px-2"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Search size={12} className="text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            placeholder ||
            `${t("homepage.searchPlaceholder")} ${ENGINE_LABELS[engine]}...`
          }
          disabled={isReadOnly}
          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 outline-none border-none min-w-0"
        />
        {query.trim() && (
          <button
            type="submit"
            className="shrink-0 text-[10px] font-medium text-accent-brand hover:opacity-80 transition-opacity"
          >
            {t("homepage.searchGo")}
          </button>
        )}
      </form>
    </div>
  );
}

registerWidget<SearchBarConfig>({
  id: "search_bar",
  name: "Search Bar",
  description: "Quick search with Google, DuckDuckGo, Bing, or a custom engine",
  category: "info",
  icon: <Search size={14} />,
  defaultConfig: { engine: "google", openInNewTab: true },
  defaultSize: { w: GRID_SIZE * 12, h: GRID_SIZE * 3 },
  minSize: { w: GRID_SIZE * 6, h: GRID_SIZE * 2 },
  component: SearchBarWidget,
});

export { SearchBarWidget };
