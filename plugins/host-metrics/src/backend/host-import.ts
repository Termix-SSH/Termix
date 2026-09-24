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
