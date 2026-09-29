import {
  hostSettingsFromTerminalConfig,
  terminalConfigFromHostSettings,
} from "../shared/terminal-settings.js";

const SWITCH_KEYS = [
  "enableTerminal",
  "enableTerminalToolbar",
  "enableCommandHistory",
] as const;

/**
 * Registered as ctx.registry.provide("ssh-terminal.hostImportNormalizer", ...)
 * so a Termix-JSON host import keeps its terminal switches, which used to be
 * host columns, and its terminal look and behavior, which a 2.8 or early 2.9
 * export carried in terminalConfig. An export that already carries this
 * plugin's pluginSettings has had them written by core, so terminalConfig is
 * only read without them.
 */
export function hostImportNormalizer(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const values: Record<string, unknown> = {};
  for (const key of SWITCH_KEYS) {
    if (raw[key] !== undefined) values[key] = raw[key] !== false;
  }

  const carried = (raw.pluginSettings as Record<string, unknown> | undefined)?.[
    "ssh-terminal"
  ];
  const hasCarried =
    !!carried && typeof carried === "object" && Object.keys(carried).length > 0;
  if (!hasCarried) {
    Object.assign(values, hostSettingsFromTerminalConfig(raw.terminalConfig));
  }

  return Object.keys(values).length > 0 ? values : null;
}

/**
 * Registered as "ssh-terminal.hostPayloadLegacy": the terminal keys of the
 * 2.8 terminalConfig, for clients that still read it (Termix-Mobile). Core
 * merges them into the terminalConfig it sends, never over a key it set.
 * Remove once the mobile app reads pluginSettings["ssh-terminal"].
 */
export function hostPayloadLegacy(
  values: Record<string, unknown>,
): Record<string, unknown> {
  return { terminalConfig: terminalConfigFromHostSettings(values) };
}
