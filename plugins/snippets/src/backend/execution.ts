export interface SnippetExecutionResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface SnippetHostVars {
  ip?: string;
  username?: string;
  port?: number | string;
  name?: string;
}

const INPUT_PATTERN =
  /\$\{INPUT_(\d+)(?::([^}$]+))?\}|\$INPUT_(\d+)(?![a-zA-Z0-9_])/g;

function replaceVar(content: string, name: string, value?: string): string {
  if (value === undefined) return content;
  const pattern = new RegExp(`\\$\\{?${name}\\}?`, "g");
  return content.replace(pattern, value);
}

/**
 * Mirrors src/ui/lib/snippet-variables.ts resolveSnippetContent. Frontend and
 * backend are separate builds, so this is kept as a small standalone copy
 * rather than a shared package for one pure function.
 */
export function resolveSnippetCommand(
  content: string,
  host: SnippetHostVars | null,
  inputValues: Record<string, string> = {},
): string {
  let resolved = content;

  resolved = replaceVar(resolved, "HOST", host?.ip);
  resolved = replaceVar(resolved, "USER", host?.username);
  resolved = replaceVar(
    resolved,
    "PORT",
    host?.port !== undefined ? String(host.port) : undefined,
  );
  resolved = replaceVar(resolved, "NAME", host?.name);

  resolved = resolved.replace(
    INPUT_PATTERN,
    (
      fullMatch,
      braceDigits: string | undefined,
      _label,
      plainDigits: string | undefined,
    ) => {
      const key = `INPUT_${braceDigits ?? plainDigits}`;
      return key in inputValues ? inputValues[key] : fullMatch;
    },
  );

  return resolved;
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
