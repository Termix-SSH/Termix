/**
 * Backend test setup: fixture plugins in core's unit tests are activated in
 * the test process instead of a child process, so loader and ctx tests do not
 * spawn Node for every case. Tests under tests/plugins/sandbox/ that check the
 * real process boundary call setPluginRunner(null) to use the supervisor.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { beforeEach } from "vitest";
import {
  setPluginRunner,
  type PluginRunner,
} from "../../plugins/sandbox/runner.js";
import type { SandboxedPluginSpec } from "../../plugins/sandbox/supervisor.js";
import type { PluginHandle } from "../../plugins/ctx.js";

interface Running {
  spec: SandboxedPluginSpec;
  handle: PluginHandle;
  deactivate?: () => unknown;
}

export function createInProcessRunner(): PluginRunner {
  const running = new Map<string, Running>();
  const runner: PluginRunner = {
    async register(spec) {
      await runner.unregister(spec.manifest.id);
      const { ctx, handle } = spec.makeContext();
      const stat = fs.statSync(spec.entryPath);
      const url = `${pathToFileURL(spec.entryPath).href}?v=${encodeURIComponent(
        `${spec.manifest.version}-${stat.mtimeMs}-${stat.size}`,
      )}`;
      const mod = (await import(url)) as {
        activate?: (ctx: unknown) => unknown;
        deactivate?: () => unknown;
        default?: {
          activate?: (ctx: unknown) => unknown;
          deactivate?: () => unknown;
        };
      };
      const activate = mod.activate ?? mod.default?.activate;
      if (typeof activate !== "function") {
        await spec.disposeHandle(handle);
        throw new Error(
          `Plugin ${spec.manifest.id} backend entry does not export an activate(ctx) function`,
        );
      }
      running.set(spec.manifest.id, {
        spec,
        handle,
        deactivate: mod.deactivate ?? mod.default?.deactivate,
      });
      try {
        await activate(ctx);
      } catch (error) {
        running.delete(spec.manifest.id);
        await spec.disposeHandle(handle);
        throw error;
      }
    },
    async unregister(pluginId) {
      const entry = running.get(pluginId);
      if (!entry) return;
      running.delete(pluginId);
      try {
        await entry.deactivate?.();
      } finally {
        await entry.spec.disposeHandle(entry.handle);
      }
    },
    async wake(pluginId) {
      return running.has(pluginId);
    },
    status() {
      return [...running.keys()].map((pluginId) => ({
        pluginId,
        state: "ready" as const,
        alwaysOn: true,
        crashes: 0,
      }));
    },
    async shutdown() {
      for (const id of [...running.keys()]) await runner.unregister(id);
    },
  };
  return runner;
}

beforeEach(() => {
  setPluginRunner(createInProcessRunner());
});
