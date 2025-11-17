import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils.ts";

interface CommandAutocompleteProps {
  suggestions: string[];
  selectedIndex: number;
  onSelect: (command: string) => void;
  position: { top: number; left: number };
  visible: boolean;
}

export function CommandAutocomplete({
  suggestions,
  selectedIndex,
  onSelect,
  position,
  visible,
}: CommandAutocompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedRef.current && containerRef.current) {
      selectedRef.current.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [selectedIndex]);

  if (!visible || suggestions.length === 0) {
    return null;
  }

  const footerHeight = 32;
  const maxSuggestionsHeight = 240 - footerHeight;

  return (
    <div
      ref={containerRef}
      className="fixed z-[9999] bg-dark-bg border border-dark-border rounded-md shadow-lg min-w-[200px] max-w-[600px] flex flex-col"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        maxHeight: "240px",
      }}
    >
      <div
        className="overflow-y-auto"
        style={{ maxHeight: `${maxSuggestionsHeight}px` }}
      >
        {suggestions.map((suggestion, index) => (
          <div
            key={index}
            ref={index === selectedIndex ? selectedRef : null}
            className={cn(
              "px-3 py-1.5 text-sm font-mono cursor-pointer transition-colors",
              "hover:bg-dark-hover",
              index === selectedIndex && "bg-gray-500/20 text-gray-400",
            )}
            onClick={() => onSelect(suggestion)}
            onMouseEnter={() => {}}
          >
            {suggestion}
          </div>
        ))}
      </div>
      <div className="px-3 py-1 text-xs text-muted-foreground border-t border-dark-border bg-dark-bg/50 shrink-0">
        Tab/Enter to complete • ↑↓ to navigate • Esc to close
      </div>
    </div>
  );
}
