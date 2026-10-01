import { readHostMetricsSettings } from "../shared/stats-widgets.js";

/**
 * Registered as ctx.registry.provide("host-metrics.hostImportNormalizer", ...)
 * for core's bulk host import. A Termix export carries these settings under
 * pluginSettings["host-metrics"]; exports from before 2.9.0 carried them in
 * statsConfig, where the host's own interval only counted when
 * useGlobalMetricsInterval was false.
 */
export function hostImportNormalizer(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const bag = raw.pluginSettings as
    Record<string, Record<string, unknown>> | undefined;
  const own = bag?.["host-metrics"];
  if (own && typeof own === "object") {
    const settings = readHostMetricsSettings(own);
    return { ...settings };
  }

  const legacy =
    raw.statsConfig && typeof raw.statsConfig === "object"
      ? (raw.statsConfig as Record<string, unknown>)
      : null;
  if (!legacy) return null;
  const settings = readHostMetricsSettings({
    ...legacy,
    metricsInterval:
      legacy.useGlobalMetricsInterval === false ? legacy.metricsInterval : null,
  });
  return { ...settings };
}

/**
 * Registered as "host-metrics.hostPayloadLegacy": the 2.8 statsConfig shape
 * Termix-Mobile still reads. Remove once the mobile app reads
 * pluginSettings["host-metrics"] and GET /host/status.
 */
export function hostPayloadLegacy(
  values: Record<string, unknown>,
  host: Record<string, unknown>,
): Record<string, unknown> {
  const settings = readHostMetricsSettings(values);
  const statusInterval =
    typeof host.statusCheckInterval === "number"
      ? host.statusCheckInterval
      : null;
  return {
    statsConfig: {
      enabledWidgets: settings.enabledWidgets,
      statusCheckEnabled: host.statusCheckEnabled !== false,
      statusCheckInterval: statusInterval ?? 30,
      useGlobalStatusInterval: statusInterval === null,
      metricsEnabled: settings.metricsEnabled,
      metricsInterval: settings.metricsInterval ?? 30,
      useGlobalMetricsInterval: settings.metricsInterval == null,
      excludedMounts: settings.excludedMounts,
      monitoredMounts: settings.monitoredMounts,
    },
  };
}
