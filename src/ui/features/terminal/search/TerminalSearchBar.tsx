import React from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import { Button } from "@/components/button";
import { Separator } from "@/components/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/tooltip";
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

interface SearchToggleProps {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}

function SearchToggle({
  label,
  active,
  onClick,
  className,
  children,
}: SearchToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "font-mono text-[11px] leading-none text-muted-foreground",
            active &&
              "border-border bg-muted text-foreground hover:bg-muted dark:bg-muted/60",
            className,
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
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

  const hasQuery = query.length > 0;
  const noResults = hasQuery && resultCount === 0;
  const resultLabel = !hasQuery
    ? ""
    : resultCount === 0
      ? t("terminal.searchNoResults")
      : t("terminal.searchResultCount", {
          index: resultIndex + 1,
          count: resultCount,
        });

  return (
    <TooltipProvider delayDuration={500}>
      <div
        className="absolute top-2 right-2 z-[130] flex items-center gap-1 border border-border bg-background/95 p-1 shadow-lg backdrop-blur-sm"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="relative flex items-center">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("terminal.searchPlaceholder")}
            aria-label={t("terminal.searchPlaceholder")}
            className={cn(
              "h-7 w-48 pr-16 font-mono",
              noResults &&
                "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20",
            )}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          <span
            className={cn(
              "pointer-events-none absolute right-2 font-mono text-[11px] tabular-nums select-none",
              noResults ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {resultLabel}
          </span>
        </div>

        <Separator orientation="vertical" className="mx-0.5 !h-5" />

        <div className="flex items-center gap-0.5">
          <SearchToggle
            label={t("terminal.searchCaseSensitive")}
            active={caseSensitive}
            onClick={onToggleCaseSensitive}
          >
            Aa
          </SearchToggle>
          <SearchToggle
            label={t("terminal.searchWholeWord")}
            active={wholeWord}
            onClick={onToggleWholeWord}
            className="underline underline-offset-2"
          >
            ab
          </SearchToggle>
          <SearchToggle
            label={t("terminal.searchRegex")}
            active={regex}
            onClick={onToggleRegex}
          >
            .*
          </SearchToggle>
        </div>

        <Separator orientation="vertical" className="mx-0.5 !h-5" />

        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("terminal.searchPrevious")}
                disabled={!hasQuery || resultCount === 0}
                onClick={onFindPrevious}
              >
                <ChevronUp />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t("terminal.searchPrevious")}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("terminal.searchNext")}
                disabled={!hasQuery || resultCount === 0}
                onClick={onFindNext}
              >
                <ChevronDown />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t("terminal.searchNext")}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("terminal.searchClose")}
                onClick={onClose}
              >
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t("terminal.searchClose")}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
