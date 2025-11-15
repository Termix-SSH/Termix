import { useState, useEffect, useCallback, useRef } from "react";
import { getCommandHistory, saveCommandToHistory } from "@/ui/main-axios.ts";

interface UseCommandHistoryOptions {
  hostId?: number;
  enabled?: boolean;
}

interface CommandHistoryResult {
  suggestions: string[];
  getSuggestions: (input: string) => string[];
  saveCommand: (command: string) => Promise<void>;
  clearSuggestions: () => void;
  isLoading: boolean;
}

export function useCommandHistory({
  hostId,
  enabled = true,
}: UseCommandHistoryOptions): CommandHistoryResult {
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const historyCache = useRef<Map<number, string[]>>(new Map());
  s;
  useEffect(() => {
    if (!enabled || !hostId) {
      setCommandHistory([]);
      setSuggestions([]);
      return;
    }

    const cached = historyCache.current.get(hostId);
    if (cached) {
      setCommandHistory(cached);
      return;
    }

    const fetchHistory = async () => {
      setIsLoading(true);
      try {
        const history = await getCommandHistory(hostId);
        setCommandHistory(history);
        historyCache.current.set(hostId, history);
      } catch (error) {
        console.error("Failed to fetch command history:", error);
        setCommandHistory([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistory();
  }, [hostId, enabled]);

  const getSuggestions = useCallback(
    (input: string): string[] => {
      if (!input || input.trim().length === 0) {
        return [];
      }

      const trimmedInput = input.trim();
      const matches = commandHistory.filter((cmd) =>
        cmd.startsWith(trimmedInput),
      );

      const filtered = matches
        .filter((cmd) => cmd !== trimmedInput)
        .slice(0, 10);

      setSuggestions(filtered);
      return filtered;
    },
    [commandHistory],
  );

  const saveCommand = useCallback(
    async (command: string) => {
      if (!enabled || !hostId || !command || command.trim().length === 0) {
        return;
      }

      const trimmedCommand = command.trim();

      if (commandHistory.length > 0 && commandHistory[0] === trimmedCommand) {
        return;
      }

      try {
        await saveCommandToHistory(hostId, trimmedCommand);

        setCommandHistory((prev) => {
          const newHistory = [
            trimmedCommand,
            ...prev.filter((c) => c !== trimmedCommand),
          ];
          const limited = newHistory.slice(0, 500);
          historyCache.current.set(hostId, limited);
          return limited;
        });
      } catch (error) {
        console.error("Failed to save command to history:", error);
        setCommandHistory((prev) => {
          const newHistory = [
            trimmedCommand,
            ...prev.filter((c) => c !== trimmedCommand),
          ];
          return newHistory.slice(0, 500);
        });
      }
    },
    [enabled, hostId, commandHistory],
  );

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
  }, []);

  return {
    suggestions,
    getSuggestions,
    saveCommand,
    clearSuggestions,
    isLoading,
  };
}
