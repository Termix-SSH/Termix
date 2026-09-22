/**
 * The backend contract: what a plugin's activate(ctx) receives.
 *
 * These are types only. Core builds the real object in
 * src/backend/plugins/ctx.ts and injects it at activation, so the SDK stays a
 * description of the contract rather than an implementation a plugin could
 * reach around.
 *
 * Members marked A3-A8 are not built yet. A plugin written against them today
 * will type-check and fail at runtime, which is the intended signal.
 */

import type { PluginManifest } from "./manifest.js";

/**
 * Thrown when a plugin calls a guarded member without the capability.
 *
 * Two things must be true: the manifest declares it, and it is granted. A
 * grant for something the manifest never declared is ignored, so widening a
 * plugin's reach always needs a new manifest the user can see.
 */
export class PluginCapabilityError extends Error {
  readonly code = "EPLUGINCAP";
  readonly pluginId: string;
  readonly capability: string;

  constructor(pluginId: string, capability: string) {
    super(
      `Plugin "${pluginId}" is not granted the "${capability}" capability. ` +
        `Declare it in the manifest's capabilities array and grant it in the plugin's settings.`,
    );
    this.name = "PluginCapabilityError";
    this.pluginId = pluginId;
    this.capability = capability;
  }
}

export interface PluginLogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, error?: Error) => void;
}

export interface PluginEvents {
  /** Topics are namespaced to plugin.<id>.* unless the plugin holds events:core. */
  emit: (topic: string, payload: unknown) => void;
  on: (topic: string, listener: (payload: unknown) => void) => () => void;
}

/** Small key/value state owned by this plugin. Requires kv:own. */
export interface PluginKeyValue {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  list: () => Promise<string[]>;
}

export interface PluginRegistry {
  provide: <T>(key: string, value: T) => void;
  consume: <T>(key: string) => T | undefined;
  revoke: (key: string, value?: unknown) => boolean;
}

export interface PluginServices {
  provide: <T extends object>(service: string, implementation: T) => void;
  get: <T extends object>(service: string, options?: { userId?: string }) => T;
}

export interface PluginSecrets {
  offer: (
    key: string,
    resolve: (userId: string) => Promise<string | null> | string | null,
  ) => void;
  withdraw: (key: string) => boolean;
  getShared: (
    pluginId: string,
    key: string,
    options?: { userId?: string },
  ) => Promise<string | null>;
}

/**
 * Anything the runtime should undo when the plugin deactivates. Everything
 * registered through ctx is tracked automatically; this is for resources a
 * plugin creates itself, such as a server or an interval.
 */
export interface PluginDisposables {
  add: (dispose: () => void | Promise<void>) => void;
}

export interface PluginContext {
  readonly pluginId: string;
  readonly manifest: PluginManifest;
  readonly log: PluginLogger;
  readonly events: PluginEvents;
  readonly kv: PluginKeyValue;
  readonly registry: PluginRegistry;
  readonly services: PluginServices;
  readonly secrets: PluginSecrets;
  readonly disposables: PluginDisposables;

  /**
   * Runs `fn` with `userId` as the acting user, for background work that has
   * no request behind it. Always audited, and every core API inside still
   * applies that user's RBAC.
   *
   * This is the only way a plugin can name a user. Nothing else trusts a user
   * id that came from plugin code.
   */
  asUser: <T>(userId: string, fn: () => Promise<T> | T) => Promise<T>;

  /** The acting user for the current call, when there is one. */
  currentActor: () => string | undefined;
}

export type PluginActivate = (ctx: PluginContext) => void | Promise<void>;
export type PluginDeactivate = () => void | Promise<void>;

export interface PluginModule {
  activate: PluginActivate;
  deactivate?: PluginDeactivate;
}

/**
 * Identity helper that gives a plugin entry its types without importing the
 * runtime. Everything a plugin creates belongs inside activate: the module is
 * cached by the ESM loader, so disable-then-enable re-runs activate on the
 * same module object.
 */
export function definePlugin(plugin: PluginModule): PluginModule {
  return plugin;
}

export type { PluginManifest } from "./manifest.js";
