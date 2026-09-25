/**
 * The built plugins really load: every bundle in dist/plugins activates on a
 * database that started in 2.8 shape, in dependency order, with every
 * service it needs provided and nothing registered twice.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assertPluginsBuilt,
  bootCore,
  builtManifest,
  create28Database,
  sourcePluginIds,
  type BootedCore,
} from "./built-harness.js";

const BOOT_TIMEOUT = 180_000;

let core: BootedCore;
const logged = { errors: [] as string[], warnings: [] as string[] };

beforeAll(async () => {
  assertPluginsBuilt();
  vi.resetModules();
  const { sqlite } = create28Database();
  const error = vi.spyOn(console, "error").mockImplementation((...args) => {
    logged.errors.push(args.map(String).join(" "));
  });
  const warn = vi.spyOn(console, "warn").mockImplementation((...args) => {
    logged.warnings.push(args.map(String).join(" "));
  });
  try {
    core = await bootCore(sqlite);
  } finally {
    error.mockRestore();
    warn.mockRestore();
  }
}, BOOT_TIMEOUT);

afterAll(async () => {
  await core?.shutdown();
}, BOOT_TIMEOUT);

describe("the built plugins on a 2.8 database", () => {
  it("boots without logging an error", () => {
    expect(logged.errors).toEqual([]);
    if (process.env.SHOW_BOOT_WARNINGS) {
      console.log(logged.warnings.join("\n"));
    }
  });

  it("activates every plugin, none failed or blocked", async () => {
    const { getPluginRuntime } = await import("../../plugins/index.js");
    const states = Object.fromEntries(
      getPluginRuntime()
        .loader.list()
        .map((plugin) => [plugin.id, plugin.state]),
    );
    expect(Object.keys(states).sort()).toEqual(sourcePluginIds());
    const notActive = Object.entries(states).filter(
      ([, state]) => state !== "active",
    );
    expect(notActive).toEqual([]);
  });

  it("gives every declared service a provider and meets every hard dependency", async () => {
    const { listServices } = await import("../../plugins/service-registry.js");
    const provided = new Set(
      listServices().map((service) => `${service.pluginId}:${service.service}`),
    );
    const ids = new Set(sourcePluginIds());

    for (const id of ids) {
      const manifest = builtManifest(id) as {
        provides?: Array<{ service: string }>;
        requires?: Array<{ service: string; optional?: boolean }>;
        dependencies?: Record<string, string>;
      };
      for (const { service } of manifest.provides ?? []) {
        expect(provided, `${id} provides ${service}`).toContain(
          `${id}:${service}`,
        );
      }
      const available = new Set(
        listServices().map((service) => service.service),
      );
      for (const requirement of manifest.requires ?? []) {
        if (requirement.optional) continue;
        expect(available, `${id} requires ${requirement.service}`).toContain(
          requirement.service,
        );
      }
      for (const dependency of Object.keys(manifest.dependencies ?? {})) {
        expect(ids, `${id} depends on ${dependency}`).toContain(dependency);
      }
    }
  });

  it("registers no route, socket or permission that clashes", async () => {
    const { listRegistrationConflicts } =
      await import("../../plugins/conflicts.js");
    expect(listRegistrationConflicts()).toEqual([]);

    const { getRegisteredWsRoutes } = await import("../../plugins/ws.js");
    const sockets = getRegisteredWsRoutes();
    expect(new Set(sockets).size).toBe(sockets.length);

    // Plugin routes live under /plugin-api/<id>/, so a clash is two plugins
    // claiming one id, which the loader refuses; a legacy path must start
    // with its own plugin id.
    for (const id of sourcePluginIds()) {
      const legacy =
        (
          builtManifest(id) as {
            contributes?: { http?: { legacyPaths?: string[] } };
          }
        ).contributes?.http?.legacyPaths ?? [];
      for (const legacyPath of legacy) {
        expect(legacyPath.startsWith(`/${id}/`)).toBe(true);
      }
    }

    const { getPermissionCatalog } =
      await import("../../utils/permission-catalog.js");
    const permissions = getPermissionCatalog().flatMap(
      (entry) => entry.permissions,
    );
    expect(new Set(permissions).size).toBe(permissions.length);
  });

  it("records every plugin migration it ran", async () => {
    const recorded = core.sqlite
      .prepare(
        "SELECT plugin_id, COUNT(*) AS n FROM plugin_migrations GROUP BY plugin_id",
      )
      .all() as Array<{ plugin_id: string; n: number }>;
    const byPlugin = new Map(recorded.map((row) => [row.plugin_id, row.n]));
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { BUILT_PLUGINS_DIR } = await import("./built-harness.js");
    for (const id of sourcePluginIds()) {
      const dir = path.join(BUILT_PLUGINS_DIR, id, "migrations", "sqlite");
      const files = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((name) => name.endsWith(".sql"))
        : [];
      expect(byPlugin.get(id) ?? 0, `${id} migrations`).toBe(files.length);
    }
  });
});
