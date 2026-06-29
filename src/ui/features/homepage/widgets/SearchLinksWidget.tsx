import { useState } from "react";
import { SearchCode } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  SearchLinksConfig,
  SearchLinkShortcut,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { WidgetTitle } from "./WidgetTitle";

function SearchLinksWidget({
  widget,
  config,
  isReadOnly,
}: WidgetComponentProps<SearchLinksConfig>) {
  const { t } = useTranslation();
  const { shortcuts } = config;
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const handleOpen = (shortcut: SearchLinkShortcut) => {
    if (!query.trim()) return;
    const url = shortcut.queryTemplate.replace(
      "{q}",
      encodeURIComponent(query.trim()),
    );
    window.open(url, "_blank", "noopener,noreferrer");
    setQuery("");
    setActiveIdx(null);
  };

  const handleButtonClick = (i: number) => {
    if (isReadOnly) return;
    if (activeIdx === i) {
      setActiveIdx(null);
      setQuery("");
    } else {
      setActiveIdx(i);
      setQuery("");
    }
  };

  if (shortcuts.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.noSearchShortcuts")}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<SearchCode size={11} />} />
      <div className="flex flex-col flex-1 p-2 gap-1.5 overflow-auto">
        <div className="flex flex-wrap gap-1.5">
          {shortcuts.map((s, i) => {
            const accent =
              s.accentColor ||
              getComputedStyle(document.documentElement)
                .getPropertyValue("--accent-brand")
                .trim() ||
              "#f59145";
            const isActive = activeIdx === i;
            return (
              <button
                key={i}
                onClick={() => handleButtonClick(i)}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium border transition-colors"
                style={
                  isActive
                    ? { background: accent, borderColor: accent, color: "#fff" }
                    : {
                        borderColor: `${accent}50`,
                        color: "var(--text-primary, currentColor)",
                      }
                }
              >
                {s.icon && <span className="text-xs">{s.icon}</span>}
                {s.label}
              </button>
            );
          })}
        </div>

        {activeIdx !== null && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleOpen(shortcuts[activeIdx]);
            }}
            className="flex items-center gap-1.5 border border-border/60 px-2 py-1"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("homepage.searchQueryPlaceholder")}
              className="flex-1 bg-transparent text-[10px] text-foreground placeholder:text-muted-foreground/60 outline-none border-none"
            />
            <button
              type="submit"
              className="text-[9px] font-medium text-accent-brand hover:opacity-80"
            >
              {t("homepage.searchGo")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

registerWidget<SearchLinksConfig>({
  id: "search_links",
  name: "Search Shortcuts",
  description: "Quick buttons to search different engines",
  category: "links",
  icon: <SearchCode size={14} />,
  defaultConfig: { shortcuts: [] },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 7 },
  minSize: { w: GRID_SIZE * 4, h: GRID_SIZE * 3 },
  component: SearchLinksWidget,
});

export { SearchLinksWidget };
