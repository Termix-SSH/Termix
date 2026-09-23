import type { PluginContext } from "@termix/plugin-sdk/backend";

let current: PluginContext | null = null;

/** Set in activate, cleared on deactivate. */
export function setPluginCtx(ctx: PluginContext | null): void {
  current = ctx;
}

export function pluginCtx(): PluginContext {
  if (!current) throw new Error("The plugin is not active");
  return current;
}
