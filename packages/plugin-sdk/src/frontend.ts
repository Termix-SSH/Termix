/**
 * The frontend contract: what a plugin's frontend entry receives.
 *
 * Stubs only. A7 builds the real loader and fills these in, at which point a
 * plugin registers every surface it contributes through this object and the
 * shell stops carrying plugin ids of its own.
 */

import type { PluginManifest } from "./manifest.js";

export interface TermixAppInfo {
  readonly pluginId: string;
  readonly manifest: PluginManifest;
}

/**
 * Registration surface for a plugin frontend.
 *
 * A7 adds: rail items, panels, tabs, host editor sections, host actions and
 * badges, context menu items, palette entries, dashboard cards, homepage
 * widgets, settings components, action slots, login/2FA UI and SSH auth
 * editors. Everything registered here is removed when the plugin is disabled.
 */
export interface TermixApp extends TermixAppInfo {
  /** Registered cleanup, run when the plugin is disabled. */
  onDispose: (dispose: () => void) => void;
}

export type FrontendActivate = (app: TermixApp) => void | Promise<void>;

export interface FrontendModule {
  activate: FrontendActivate;
  deactivate?: () => void | Promise<void>;
}

export function definePluginFrontend(plugin: FrontendModule): FrontendModule {
  return plugin;
}

export type { PluginManifest } from "./manifest.js";
