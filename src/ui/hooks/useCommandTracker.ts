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

/**
 * Hook to track terminal input and save executed commands to history
 * Works with SSH terminals by monitoring input data
 */
export function useCommandTracker({
  hostId,
  enabled = true,
  onCommandExecuted,
}: UseCommandTrackerOptions): CommandTrackerResult {
  const currentCommandRef = useRef<string>("");
  const isInEscapeSequenceRef = useRef<boolean>(false);

  /**
   * Track input data and detect command execution
   */
  const trackInput = useCallback(
    (data: string) => {
      if (!enabled || !hostId) {
        return;
      }

      // Handle each character
      for (let i = 0; i < data.length; i++) {
        const char = data[i];
        const charCode = char.charCodeAt(0);

        // Detect escape sequences (e.g., arrow keys, function keys)
        if (charCode === 27) {
          // ESC
          isInEscapeSequenceRef.current = true;
          continue;
        }

        // Skip characters that are part of escape sequences
        if (isInEscapeSequenceRef.current) {
          // Common escape sequence endings
          if (
            (charCode >= 65 && charCode <= 90) || // A-Z
            (charCode >= 97 && charCode <= 122) || // a-z
            charCode === 126 // ~
          ) {
            isInEscapeSequenceRef.current = false;
          }
          continue;
        }

        // Handle Enter key (CR or LF)
        if (charCode === 13 || charCode === 10) {
          // \r or \n
          const command = currentCommandRef.current.trim();

          // Save non-empty commands
          if (command.length > 0) {
            // Save to history (async, don't wait)
            saveCommandToHistory(hostId, command).catch((error) => {
              console.error("Failed to save command to history:", error);
            });

            // Callback for external handling
            if (onCommandExecuted) {
              onCommandExecuted(command);
            }
          }

          // Clear current command
          currentCommandRef.current = "";
          continue;
        }

        // Handle Backspace/Delete
        if (charCode === 8 || charCode === 127) {
          // Backspace or DEL
          if (currentCommandRef.current.length > 0) {
            currentCommandRef.current = currentCommandRef.current.slice(0, -1);
          }
          continue;
        }

        // Handle Ctrl+C, Ctrl+D, etc. - clear current command
        if (charCode === 3 || charCode === 4) {
          currentCommandRef.current = "";
          continue;
        }

        // Handle Ctrl+U (clear line) - common in terminals
        if (charCode === 21) {
          currentCommandRef.current = "";
          continue;
        }

        // Add printable characters to current command
        if (charCode >= 32 && charCode <= 126) {
          // Printable ASCII
          currentCommandRef.current += char;
        }
      }
    },
    [enabled, hostId, onCommandExecuted]
  );

  /**
   * Get the current command being typed
   */
  const getCurrentCommand = useCallback(() => {
    return currentCommandRef.current;
  }, []);

  /**
   * Clear the current command buffer
   */
  const clearCurrentCommand = useCallback(() => {
    currentCommandRef.current = "";
  }, []);

  /**
   * Update the current command buffer (used for autocomplete)
   */
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
