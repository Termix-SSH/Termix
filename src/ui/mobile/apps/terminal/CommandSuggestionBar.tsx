interface CommandSuggestionBarProps {
  suggestions: string[];
  onSelect: (command: string) => void;
}

export function CommandSuggestionBar({
  suggestions,
  onSelect,
}: CommandSuggestionBarProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="px-2 pb-1">
      <div className="flex gap-2 overflow-x-auto thin-scrollbar">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="shrink-0 rounded-full border border-edge bg-elevated px-3 py-1.5 text-left text-xs font-mono text-foreground-secondary transition-colors hover:bg-hover"
            onClick={() => onSelect(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
