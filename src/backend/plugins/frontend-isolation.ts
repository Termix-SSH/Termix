// Where a plugin's browser code runs. API 2 plugins run in sandboxed frames
// with an opaque origin; API 1 plugins still load into the page until they
// move to API 2. Layouts, themes, login screens and native desktop views are
// the shell itself, so an official API 2 plugin that provides them keeps
// running in the page.

import {
  isLegacyPluginApi,
  type PluginManifest,
} from "@termix-ssh/plugin-sdk/manifest";
import { isOfficialPlugin } from "./isolation.js";

export type FrontendIsolation = "frame" | "page";

/** Capabilities whose UI is part of the shell rather than inside it. */
export const SHELL_PART_CAPABILITIES = [
  "ui:layout",
  "ui:theme",
  "auth:provide",
  // Native views sit over the desktop window, outside any frame.
  "desktop:window",
  // Web Serial needs the page's own origin, and a frame's is opaque.
  "device:serial",
  // Linking the desktop app and switching accounts use the app window's own
  // calls. This plugin can issue sessions anyway.
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
