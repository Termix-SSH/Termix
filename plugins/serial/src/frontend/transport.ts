import type { TermixApp } from "@termix/plugin-sdk/frontend";

/**
 * The live app.wsUrl, for components that are defined at module scope rather
 * than inside activate(). Set on activate, cleared on dispose, the same
 * pattern the tunnels plugin uses for app.api.
 */
let wsUrl: TermixApp["wsUrl"] | null = null;

export function setSerialWsUrl(next: TermixApp["wsUrl"] | null): void {
  wsUrl = next;
}

/**
 * The console's WebSocket URL and auth subprotocols. No origin option: a
 * serial device is physically attached to this desktop machine, so it
 * always dials the embedded local backend rather than a connected remote
 * sync server (app.wsUrl's default when no origin is given).
 */
export async function resolveSerialWsUrl() {
  if (!wsUrl) return null;
  return wsUrl("/console");
}
