import { useSyncExternalStore } from "react";
import type { SnippetHostContext } from "../shared/variables.js";

export interface PendingPrompt {
  snippet: { name: string; content: string };
  host: SnippetHostContext | null;
  settle: (values: Record<string, string> | null) => void;
}

let pending: PendingPrompt | null = null;
let confirmExecution = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Asks for a snippet's $INPUT_n values through the dialog the overlay draws.
 * Resolves null when the user cancels. A second request cancels the first.
 */
export function askForInputs(
  snippet: { name: string; content: string },
  host: SnippetHostContext | null,
): Promise<Record<string, string> | null> {
  pending?.settle(null);
  return new Promise((resolve) => {
    const prompt: PendingPrompt = {
      snippet,
      host,
      settle: (values) => {
        if (pending === prompt) {
          pending = null;
          notify();
        }
        resolve(values);
      },
    };
    pending = prompt;
    notify();
  });
}

export function usePendingPrompt(): PendingPrompt | null {
  return useSyncExternalStore(
    subscribe,
    () => pending,
    () => pending,
  );
}

/** Kept current by the overlay from the user's confirmExecution setting. */
export function setConfirmExecution(value: boolean): void {
  confirmExecution = value;
}

export function shouldConfirmExecution(): boolean {
  return confirmExecution;
}

/** Cancels anything waiting, for deactivate. */
export function resetPrompts(): void {
  pending?.settle(null);
  pending = null;
  confirmExecution = false;
  notify();
}
