import { serializeWebUiConfig } from "../shared/web-endpoint-config.js";

/**
 * Registered as ctx.registry.provide("web-endpoint.hostImportNormalizer", ...)
 * so host-bulk-routes.ts's Termix-JSON import path can validate this
 * plugin's fields without importing anything from the plugin. Matches the
 * shape core's PluginHostImportNormalizer type expects.
 */
export function hostImportNormalizer(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  if (raw.enableWebUi === undefined && raw.webUiConfig === undefined) {
    return null;
  }
  return {
    enableWebUi: !!raw.enableWebUi,
    webUiConfig: raw.webUiConfig ? serializeWebUiConfig(raw.webUiConfig) : null,
  };
}
