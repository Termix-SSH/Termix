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
