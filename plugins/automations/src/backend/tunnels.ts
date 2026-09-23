import type { PluginServices } from "@termix/plugin-sdk/backend";

let current: PluginServices | null = null;

/** Set in activate, cleared on deactivate. */
export function setTunnelServices(services: PluginServices | null): void {
  current = services;
}

/** The tunnels plugin, as ctx.services.get("tunnels.access") returns it. */
interface TunnelsAccess {
  start: (name: string) => Promise<void>;
  stop: (name: string) => Promise<void>;
}

export interface TunnelActionResult {
  ok: boolean;
  /** True when the tunnels plugin is off or the user may not use it. */
  unavailable?: boolean;
  error?: string;
}

/**
 * Connects or disconnects a saved tunnel as userId. Optional: without the
 * tunnels plugin the step fails with a clear message rather than the plugin
 * failing to activate.
 */
export async function runTunnelAction(
  userId: string,
  action: "connect" | "disconnect",
  name: string,
): Promise<TunnelActionResult> {
  if (!current) {
    return {
      ok: false,
      unavailable: true,
      error: "The tunnels plugin is not available",
    };
  }

  let tunnels: TunnelsAccess;
  try {
    tunnels = current.get<TunnelsAccess>("tunnels.access", { userId });
  } catch {
    return {
      ok: false,
      unavailable: true,
      error: "The tunnels plugin is not available",
    };
  }

  try {
    if (action === "connect") await tunnels.start(name);
    else await tunnels.stop(name);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      unavailable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
