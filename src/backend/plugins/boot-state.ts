/**
 * Plugins to start at boot. One that failed or was blocked last run is still
 * one the admin turned on, so a restart tries it again rather than leaving it
 * looking disabled.
 */
export function startablePluginIds(
  records: { id: string; state: string }[],
): Set<string> {
  return new Set(
    records
      .filter((record) =>
        ["enabled", "failed", "blocked"].includes(record.state),
      )
      .map((record) => record.id),
  );
}

/**
 * Plugins that shipped in an earlier image and were left on, but whose code is
 * not in this one (a smaller image tag). They get fetched from the registry.
 */
export function missingShippedPluginIds(
  records: { id: string; tier: string; state: string }[],
  presentIds: ReadonlySet<string>,
  ignored: ReadonlySet<string>,
): string[] {
  return records
    .filter(
      (record) =>
        record.tier === "bundled" &&
        record.state !== "disabled" &&
        !presentIds.has(record.id) &&
        !ignored.has(record.id),
    )
    .map((record) => record.id)
    .sort();
}
