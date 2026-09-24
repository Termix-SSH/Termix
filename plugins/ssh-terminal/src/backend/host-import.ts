/**
 * Registered as ctx.registry.provide("ssh-terminal.hostImportNormalizer", ...)
 * so a Termix-JSON host import keeps its terminal switches, which used to be
 * host columns and are this plugin's host settings now.
 */
export function hostImportNormalizer(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const keys = [
    "enableTerminal",
    "enableTerminalToolbar",
    "enableCommandHistory",
  ] as const;
  if (keys.every((key) => raw[key] === undefined)) return null;
  const values: Record<string, unknown> = {};
  for (const key of keys) {
    if (raw[key] !== undefined) values[key] = raw[key] !== false;
  }
  return values;
}
