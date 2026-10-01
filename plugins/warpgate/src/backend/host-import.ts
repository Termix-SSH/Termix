/**
 * Registered as "warpgate.hostImportNormalizer" so core's host import keeps
 * the flag. Reads a Termix export's pluginSettings.warpgate first, then the
 * useWarpgate host field exports had before 2.9.0.
 */
export function hostImportNormalizer(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const pluginSettings = raw.pluginSettings as
    Record<string, Record<string, unknown> | undefined> | undefined;
  const value = pluginSettings?.warpgate?.useWarpgate ?? raw.useWarpgate;
  if (value === undefined || value === null) return null;
  return { useWarpgate: value === true || value === 1 || value === "true" };
}
