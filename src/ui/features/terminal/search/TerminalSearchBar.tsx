import React from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils.ts";

interface TerminalSearchBarProps {
  visible: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onClose: () => void;
  caseSensitive: boolean;
  onToggleCaseSensitive: () => void;
  wholeWord: boolean;
  onToggleWholeWord: () => void;
  regex: boolean;
  onToggleRegex: () => void;
  resultIndex: number;
  resultCount: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export function TerminalSearchBar({
  visible,
  query,
  onQueryChange,
  onFindNext,
  onFindPrevious,
  onClose,
  caseSensitive,
  onToggleCaseSensitive,
  wholeWord,
  onToggleWholeWord,
  regex,
  onToggleRegex,
  resultIndex,
  resultCount,
  inputRef,
}: TerminalSearchBarProps) {
  const { t } = useTranslation();

  if (!visible) {
    return null;
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        onFindPrevious();
      } else {
        onFindNext();
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    // Stop keys like Ctrl+C/Ctrl+V from bubbling up to xterm's document-level
    // paste/clipboard handling while the search input is focused.
    e.stopPropagation();
  };

  const toggleButtonClass = (active: boolean) =>
    cn(
      "flex h-6 w-6 shrink-0 items-center justify-center rounded-none border border-transparent text-xs font-semibold text-muted-foreground transition-colors hover:bg-hover hover:text-foreground",
      active && "border-edge bg-accent text-accent-foreground",
    );

  const resultLabel =
    query.length === 0
      ? ""
      : resultCount === 0
        ? t("terminal.searchNoResults")
        : t("terminal.searchResultCount", {
            index: resultIndex + 1,
            count: resultCount,
          });

  return (
    <div className="absolute top-2 right-2 z-[130] flex items-center gap-1 rounded-md border border-edge bg-canvas px-1.5 py-1 shadow-lg">
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t("terminal.searchPlaceholder")}
        className="h-6 w-40 rounded-none border-none bg-transparent px-1.5 text-xs shadow-none focus-visible:ring-0"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
      />

      <span className="min-w-[64px] shrink-0 text-center text-xs text-muted-foreground select-none">
        {resultLabel}
      </span>

      <div className="flex items-center gap-0.5 border-l border-edge pl-1">
        <button
          type="button"
          title={t("terminal.searchCaseSensitive")}
          aria-pressed={caseSensitive}
          className={toggleButtonClass(caseSensitive)}
          onClick={onToggleCaseSensitive}
        >
          Aa
        </button>
        <button
          type="button"
          title={t("terminal.searchWholeWord")}
          aria-pressed={wholeWord}
          className={cn(toggleButtonClass(wholeWord), "underline")}
          onClick={onToggleWholeWord}
        >
          ab
        </button>
        <button
          type="button"
          title={t("terminal.searchRegex")}
          aria-pressed={regex}
          className={toggleButtonClass(regex)}
          onClick={onToggleRegex}
        >
          .*
        </button>
      </div>

      <div className="flex items-center gap-0.5 border-l border-edge pl-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={t("terminal.searchPrevious")}
          onClick={onFindPrevious}
        >
          <ChevronUp />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={t("terminal.searchNext")}
          onClick={onFindNext}
        >
          <ChevronDown />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={t("terminal.searchClose")}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
