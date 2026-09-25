/** One of this plugin's host settings, from the host payload. */
export function fileManagerHostSetting<T>(
  host: object | null | undefined,
  key: "enableFileManager" | "defaultPath" | "scpLegacy",
  fallback: T,
): T {
  const settings = (
    host as { pluginSettings?: Record<string, Record<string, unknown>> } | null
  )?.pluginSettings;
  const value = settings?.["file-manager"]?.[key];
  return value === undefined || value === null || value === ""
    ? fallback
    : (value as T);
}
