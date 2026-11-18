/**
 * Lets the connect path wait for a plugin that is still starting, so a host
 * whose auth type or secret scheme it provides is not reported as needing a
 * plugin that is installed and on its way up. Set by the plugin runtime.
 */
let waiter: (pluginId: string) => Promise<void> = async () => {};

export function setPluginStartupWaiter(
  fn: (pluginId: string) => Promise<void>,
): void {
  waiter = fn;
}

/** Resolves once the plugin is no longer starting, or right away. */
export function waitForPluginStartup(pluginId: string): Promise<void> {
  return waiter(pluginId);
}
