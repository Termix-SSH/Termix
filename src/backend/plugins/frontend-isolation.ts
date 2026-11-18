// Where a plugin's browser code runs. API 2 plugins run in sandboxed frames
// with an opaque origin; API 1 plugins still load into the page until they
// move to API 2. Only what is the shell itself stays in the page for an
// official plugin. Login steps, security keys, native views and serial ports
// go through shell bridges instead (see ARCHITECTURE.md, S29).

import {
  isLegacyPluginApi,
  type PluginManifest,
} from "@termix-ssh/plugin-sdk/manifest";
import { isOfficialPlugin } from "./isolation.js";

export type FrontendIsolation = "frame" | "page";

/** Capabilities whose UI is part of the shell rather than inside it. */
export const SHELL_PART_CAPABILITIES = [
  // A layout draws the shell.
  "ui:layout",
  // Theme CSS styles the page; it is checked to load nothing from elsewhere.
  "ui:theme",
  // Switching accounts and linking the desktop app set the window's own
  // session. This plugin can issue sessions on its backend anyway.
  "sync:provide",
];

export function frontendIsolation(plugin: {
  manifest: Pick<PluginManifest, "engine" | "capabilities">;
  source?: string;
  signedTier?: string;
}): FrontendIsolation {
  if (isLegacyPluginApi(String(plugin.manifest.engine?.api ?? ""))) {
    return "page";
  }
  const shellPart = (plugin.manifest.capabilities ?? []).some((capability) =>
    SHELL_PART_CAPABILITIES.includes(capability),
  );
  if (
    shellPart &&
    isOfficialPlugin({
      source: plugin.source ?? "",
      signedTier: plugin.signedTier,
    })
  ) {
    return "page";
  }
  return "frame";
}
