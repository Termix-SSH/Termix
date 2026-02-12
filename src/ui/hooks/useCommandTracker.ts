import { useRef, useCallback } from "react";
import { saveCommandToHistory } from "@/ui/main-axios.ts";

interface UseCommandTrackerOptions {
  hostId?: number;
  enabled?: boolean;
  onCommandExecuted?: (command: string) => void;
}

interface CommandTrackerResult {
  trackInput: (data: string) => void;
  getCurrentCommand: () => string;
  clearCurrentCommand: () => void;
  updateCurrentCommand: (command: string) => void;
}

export function useCommandTracker({
  hostId,
  enabled = true,
  onCommandExecuted,
}: UseCommandTrackerOptions): CommandTrackerResult {
  const currentCommandRef = useRef<string>("");
  const isInEscapeSequenceRef = useRef<boolean>(false);

  const trackInput = useCallback(
    (data: string) => {
      if (!enabled || !hostId) {
        return;
      }

      for (let i = 0; i < data.length; i++) {
        const char = data[i];
        const charCode = char.charCodeAt(0);

        if (charCode === 27) {
          isInEscapeSequenceRef.current = true;
          continue;
        }

        if (isInEscapeSequenceRef.current) {
          if (
            (charCode >= 65 && charCode <= 90) ||
            (charCode >= 97 && charCode <= 122) ||
            charCode === 126
          ) {
            isInEscapeSequenceRef.current = false;
          }
          continue;
        }

        if (charCode === 13 || charCode === 10) {
          const command = currentCommandRef.current.trim();

          if (command.length > 0) {
            saveCommandToHistory(hostId, command).catch((error) => {
              console.error("Failed to save command to history:", error);
            });

            if (onCommandExecuted) {
              onCommandExecuted(command);
            }
          }

          currentCommandRef.current = "";
          continue;
        }

        if (charCode === 8 || charCode === 127) {
          if (currentCommandRef.current.length > 0) {
            currentCommandRef.current = currentCommandRef.current.slice(0, -1);
          }
          continue;
        }

        if (charCode === 3 || charCode === 4) {
          currentCommandRef.current = "";
          continue;
        }

        if (charCode === 21) {
          currentCommandRef.current = "";
          continue;
        }

        if (charCode >= 32 && charCode <= 126) {
          currentCommandRef.current += char;
        }
      }
    },
    [enabled, hostId, onCommandExecuted],
  );

  const getCurrentCommand = useCallback(() => {
    return currentCommandRef.current;
  }, []);

  const clearCurrentCommand = useCallback(() => {
    currentCommandRef.current = "";
  }, []);

  const updateCurrentCommand = useCallback((command: string) => {
    currentCommandRef.current = command;
  }, []);

  return {
    trackInput,
    getCurrentCommand,
    clearCurrentCommand,
    updateCurrentCommand,
  };
}
