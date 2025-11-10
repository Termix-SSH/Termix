import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

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

  // Scroll selected item into view
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

  return (
    <div
      ref={containerRef}
      className="fixed z-[9999] bg-dark-bg border border-dark-border rounded-md shadow-lg max-h-[240px] overflow-y-auto min-w-[200px] max-w-[600px]"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      {suggestions.map((suggestion, index) => (
        <div
          key={index}
          ref={index === selectedIndex ? selectedRef : null}
          className={cn(
            "px-3 py-1.5 text-sm font-mono cursor-pointer transition-colors",
            "hover:bg-dark-hover",
            index === selectedIndex && "bg-blue-500/20 text-blue-400",
          )}
          onClick={() => onSelect(suggestion)}
          onMouseEnter={() => {
            // Optional: update selected index on hover
          }}
        >
          {suggestion}
        </div>
      ))}
      <div className="px-3 py-1 text-xs text-muted-foreground border-t border-dark-border bg-dark-bg/50">
        Tab/Enter to complete • ↑↓ to navigate • Esc to close
      </div>
    </div>
  );
}
