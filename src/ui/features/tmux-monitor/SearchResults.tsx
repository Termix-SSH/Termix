import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { TmuxSearchMatch, TmuxSearchResult } from "@/api/tmux-monitor-api";

interface SearchResultsProps {
  results: TmuxSearchMatch[];
  searching: boolean;
  /** The query that produced these results, used to highlight matches. */
  query: string;
  /** Search-limit info; renders a "partial results" note when truncated. */
  limits: Pick<
    TmuxSearchResult,
    "truncated" | "searchedLines" | "maxPanes"
  > | null;
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
      <mark className="rounded-sm bg-accent-brand/30 px-0 text-foreground">
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
  limits,
  onSelect,
  onClose,
}: SearchResultsProps) {
  const { t } = useTranslation();

  return (
    <div className="max-h-56 overflow-y-auto border-b border-border bg-card">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className="truncate text-xs text-muted-foreground">
          {searching
            ? t("common.loading")
            : t("tmuxMonitor.searchResults", { count: results.length })}
          {!searching && limits?.truncated && (
            <span className="ml-2 text-muted-foreground/70">
              {t("tmuxMonitor.searchTruncated", {
                lines: limits.searchedLines,
                panes: limits.maxPanes,
              })}
            </span>
          )}
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
          className="flex cursor-pointer items-baseline gap-2 px-3 py-1 text-xs hover:bg-muted/40"
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
