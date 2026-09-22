/**
 * Test helpers for plugin authors.
 *
 * A2 adds the shared vitest preset each plugin's config extends. For now this
 * exposes the one thing a plugin test needs before that lands: a context
 * double that satisfies the PluginContext contract without a running server.
 */

import type {
  PluginContext,
  PluginDisposables,
  PluginLogger,
} from "./backend.js";
import type { PluginManifest } from "./manifest.js";

export interface FakeContextOptions {
  pluginId?: string;
  manifest?: Partial<PluginManifest>;
  /** Acting user returned by currentActor and used by asUser. */
  actor?: string;
}

export interface FakePluginContext {
  ctx: PluginContext;
  /** Everything the plugin registered through ctx.disposables. */
  disposals: Array<() => void | Promise<void>>;
  /** Topics emitted through ctx.events.emit, in order. */
  emitted: Array<{ topic: string; payload: unknown }>;
  /** Backing store behind ctx.kv. */
  kv: Map<string, unknown>;
}

function noopLogger(): PluginLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

/**
 * A context double good enough to call activate() against in a unit test.
 * Nothing here is capability-checked: a test asserting a capability gate
 * should use the real runtime, not this.
 */
export function createFakeContext(
  options: FakeContextOptions = {},
): FakePluginContext {
  const pluginId = options.pluginId ?? "test-plugin";
  const disposals: Array<() => void | Promise<void>> = [];
  const emitted: Array<{ topic: string; payload: unknown }> = [];
  const kv = new Map<string, unknown>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  let actor = options.actor;

  const manifest = {
    id: pluginId,
    name: pluginId,
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities: [],
    ...options.manifest,
  } as PluginManifest;

  const disposables: PluginDisposables = {
    add: (dispose) => disposals.push(dispose),
  };

  const ctx: PluginContext = {
    pluginId,
    manifest,
    log: noopLogger(),

    events: {
      emit: (topic, payload) => {
        emitted.push({ topic, payload });
        for (const listener of listeners.get(topic) ?? []) listener(payload);
      },
      on: (topic, listener) => {
        let set = listeners.get(topic);
        if (!set) {
          set = new Set();
          listeners.set(topic, set);
        }
        set.add(listener);
        return () => set!.delete(listener);
      },
    },

    kv: {
      get: async (key) => (kv.has(key) ? kv.get(key) : null),
      set: async (key, value) => {
        kv.set(key, value);
      },
      delete: async (key) => kv.delete(key),
      list: async () => [...kv.keys()],
    },

    registry: {
      provide: () => {},
      consume: () => undefined,
      revoke: () => false,
    },

    services: {
      provide: () => {},
      get: () => {
        throw new Error("createFakeContext does not implement services.get");
      },
    },

    secrets: {
      offer: () => {},
      withdraw: () => false,
      getShared: async () => null,
    },

    disposables,

    asUser: async (userId, fn) => {
      const previous = actor;
      actor = userId;
      try {
        return await fn();
      } finally {
        actor = previous;
      }
    },

    currentActor: () => actor,
  };

  return { ctx, disposals, emitted, kv };
}
