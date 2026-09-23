import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Extract a stable, human-readable message from an unknown thrown value.
 * Mirrors src/ui/lib/error-message.ts - kept as a small standalone copy
 * rather than a cross-plugin dependency for one pure function.
 */
export function getErrorMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  return error instanceof Error ? error.message : fallback;
}

export interface SnippetInput {
  key: string;
  label: string;
}

const INPUT_PATTERN =
  /\$\{INPUT_(\d+)(?::([^}$]+))?\}|\$INPUT_(\d+)(?![a-zA-Z0-9_])/g;

/**
 * Finds the $INPUT_n placeholders in a command, for the fleet run box's
 * input fields. Mirrors src/ui/lib/snippet-variables.ts extractSnippetInputs.
 */
export function extractSnippetInputs(content: string): SnippetInput[] {
  const seen = new Map<string, SnippetInput>();
  let match: RegExpExecArray | null;
  INPUT_PATTERN.lastIndex = 0;
  while ((match = INPUT_PATTERN.exec(content)) !== null) {
    const digits = match[1] ?? match[3];
    const key = `INPUT_${digits}`;
    if (!seen.has(key)) {
      seen.set(key, { key, label: match[2]?.trim() || `Input ${digits}` });
    }
  }
  return Array.from(seen.values());
}
