/**
 * Registered as "ai.hostImportNormalizer" so core's host import can carry the
 * assistant switch without knowing it exists. Reads a Termix export's
 * pluginSettings.ai first, then the flat field hosts had before 2.9.0.
 */
export function hostImportNormalizer(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const pluginSettings = raw.pluginSettings as
    Record<string, Record<string, unknown> | undefined> | undefined;
  const value = pluginSettings?.ai?.enableAiAssistant ?? raw.enableAiAssistant;
  if (value === undefined || value === null) return null;
  return {
    enableAiAssistant: value === true || value === 1 || value === "true",
  };
}
