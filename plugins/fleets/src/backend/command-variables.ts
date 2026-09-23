export interface CommandHostVars {
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
 * $HOST/$USER/$PORT/$NAME/$INPUT_n substitution for an ad hoc fleet command,
 * typed directly into the "run on fleet" box rather than loaded from a saved
 * snippet. Mirrors the snippets plugin's own resolveSnippetCommand and the
 * frontend's src/ui/lib/snippet-variables.ts - kept as a small standalone
 * copy rather than a cross-plugin dependency for one pure function with no
 * snippet data of its own to fetch.
 */
export function resolveCommandVariables(
  content: string,
  host: CommandHostVars | null,
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
