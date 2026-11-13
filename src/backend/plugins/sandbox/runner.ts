/**
 * What the loader hands an API 2 plugin to. In the server this is always the
 * supervisor; core's own unit tests swap in a runner that activates fixture
 * plugins in the test process (src/backend/test-helpers).
 */
import type { SandboxedPluginSpec, SandboxStatus } from "./supervisor.js";

export interface PluginRunner {
  register(spec: SandboxedPluginSpec): Promise<void>;
  unregister(pluginId: string): Promise<void>;
  wake(pluginId: string): Promise<boolean>;
  status(): SandboxStatus[];
  shutdown(): Promise<void>;
}

let override: PluginRunner | null = null;

/** Test seam. */
export function setPluginRunner(runner: PluginRunner | null): void {
  override = runner;
}

export async function getPluginRunner(): Promise<PluginRunner> {
  if (override) return override;
  const { getSandboxSupervisor } = await import("./supervisor.js");
  return getSandboxSupervisor();
}
