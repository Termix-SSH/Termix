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
