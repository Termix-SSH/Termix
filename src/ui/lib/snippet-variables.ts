export interface SnippetInput {
  key: string;
  label: string;
}

export interface SnippetHostContext {
  ip?: string;
  username?: string;
  port?: number | string;
  name?: string;
}

const INPUT_PATTERN =
  /\$\{INPUT_(\d+)(?::([^}$]+))?\}|\$INPUT_(\d+)(?![a-zA-Z0-9_])/g;

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

export function hasSnippetInputs(content: string): boolean {
  INPUT_PATTERN.lastIndex = 0;
  return INPUT_PATTERN.test(content);
}

function replaceVar(
  content: string,
  name: string,
  value: string | undefined,
): string {
  if (value === undefined) return content;
  const pattern = new RegExp(`\\$\\{?${name}\\}?`, "g");
  return content.replace(pattern, value);
}

export function resolveSnippetContent(
  content: string,
  host: SnippetHostContext | null,
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
