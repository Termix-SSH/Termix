/**
 * Return an absolute POSIX path as one safe shell argument for terminal input.
 *
 * The backend already constrains this to an absolute agent-visible path. This
 * helper handles spaces and shell metacharacters at the final terminal-input
 * boundary so configured paths cannot become shell syntax.
 */
export function quoteTerminalImagePath(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
