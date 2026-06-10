import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { TmuxSearchMatch } from "@/api/tmux-monitor-api";

interface SearchResultsProps {
  results: TmuxSearchMatch[];
  searching: boolean;
  /** The query that produced these results, used to highlight matches. */
  query: string;
  onSelect: (match: TmuxSearchMatch) => void;
  onClose: () => void;
}

function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-yellow-500/30 px-0 text-yellow-200">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

export function SearchResults({
  results,
  searching,
  query,
  onSelect,
  onClose,
}: SearchResultsProps) {
  const { t } = useTranslation();

  return (
    <div className="max-h-56 overflow-y-auto border-b border-dark-border bg-dark-bg-darker">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs text-muted-foreground">
          {searching
            ? t("common.loading")
            : t("tmuxMonitor.searchResults", { count: results.length })}
        </span>
        <button
          className="text-muted-foreground hover:text-foreground"
          title={t("tmuxMonitor.closeSearchResults")}
          onClick={onClose}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {results.map((match, i) => (
        <div
          key={`${match.paneId}-${match.line}-${i}`}
          className="flex cursor-pointer items-baseline gap-2 px-3 py-1 text-xs hover:bg-dark-hover"
          onClick={() => onSelect(match)}
        >
          <span className="shrink-0 font-medium text-primary">
            {match.sessionName} · {match.paneId}
          </span>
          <span className="truncate font-mono text-muted-foreground">
            {highlightMatch(match.text, query)}
          </span>
        </div>
      ))}
    </div>
  );
}
