/**
 * What core needs from the Remote Desktop plugin, resolved through the plugin
 * registry rather than an import: restarting its guacd WebSocket server after
 * an admin edits the guacd URL setting.
 *
 * The plugin publishes "remote-desktop.sessions" through ctx.registry on
 * activate and the registry revokes it on deactivate. A restart while it is
 * off does nothing, because resurrecting a server the plugin does not own
 * would be worse than doing nothing.
 */

import { consume } from "../plugins/registry.js";

export const GUACAMOLE_SESSIONS_KEY = "remote-desktop.sessions";

export interface GuacamoleSessionProvider {
  restart: () => Promise<void>;
}

/** Restarts the plugin's guacd WebSocket server. A no-op while it is off. */
export async function restartGuacamoleService(): Promise<void> {
  await consume<GuacamoleSessionProvider>(GUACAMOLE_SESSIONS_KEY)?.restart();
}
