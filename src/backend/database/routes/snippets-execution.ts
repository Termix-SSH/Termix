export interface SnippetExecutionResult {
  success: boolean;
  output: string;
  error?: string;
}

export function getSnippetExecutionTimeoutMs(
  value = process.env.SNIPPET_EXECUTION_TIMEOUT_SECONDS,
): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;

  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;

  return seconds * 1000;
}

export function createSnippetExecutionResult(
  exitCode: number | null,
  output: string,
  errorOutput: string,
): SnippetExecutionResult {
  const success = exitCode === 0 || (exitCode === null && !errorOutput);
  return {
    success,
    output,
    ...(errorOutput ? { error: errorOutput } : {}),
  };
}
