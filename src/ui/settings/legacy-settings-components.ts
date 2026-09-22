/**
 * Core-side registration of plugin settings components.
 *
 * TEMPORARY. A `type: "custom"` settings field names a component the plugin's
 * own frontend bundle should register through `app.registerSettingsComponent`.
 * There is no frontend plugin loader yet, so core registers the handful that
 * exist, the same way pluginLoader.ts mirrors the first-party action
 * contributions.
 *
 * A7 deletes this file. Each plugin registers its own component from its
 * bundle, and nothing in core names a plugin id.
 *
 * Only register what is needed now. Everything else waits for its own step:
 * the AI providers list stays where it is until B18.
 */

import { registerSettingsComponent } from "./settings-components.js";
import { TailscaleDevicesStatus } from "./components/TailscaleDevicesStatus.js";

let registered = false;

export function registerLegacySettingsComponents(): void {
  if (registered) return;
  registered = true;

  registerSettingsComponent("tailscale", "devices", TailscaleDevicesStatus);
}
