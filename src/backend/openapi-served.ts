/**
 * The API spec this server can answer: core's own (written at build time)
 * plus each active plugin's openapi.json from its package, with servers set
 * to this server's address. Off unless SERVE_OPENAPI is "true".
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Spec = {
  openapi?: string;
  info?: Record<string, unknown>;
  servers?: Array<{ url: string; description?: string }>;
  paths?: Record<string, unknown>;
  tags?: Array<{ name: string } & Record<string, unknown>>;
  components?: Record<string, Record<string, unknown>>;
};

export interface SpecPlugin {
  id: string;
  dir: string;
  state: string;
  version?: string;
}

export function openApiEnabled(): boolean {
  return process.env.SERVE_OPENAPI === "true";
}

function readSpec(file: string): Spec | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Spec;
    return parsed && typeof parsed === "object" && parsed.paths ? parsed : null;
  } catch {
    return null;
  }
}

/** Core's spec next to the built backend, or null in a source checkout. */
export function coreSpecPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "openapi.json");
}

/** A plugin's paths only count under its own /plugin-api/<id>/ prefix. */
function ownPaths(id: string, paths: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [route, item] of Object.entries(paths)) {
    if (
      route.startsWith(`/plugin-api/${id}/`) ||
      route === `/plugin-api/${id}` ||
      route.startsWith(`/plugin-ws/${id}/`)
    ) {
      out[route] = item;
    }
  }
  return out;
}

export function mergeSpecs(
  core: Spec | null,
  plugins: Array<{ id: string; spec: Spec }>,
  baseUrl: string,
  version: string,
): Spec {
  const merged: Spec = {
    openapi: core?.openapi ?? "3.0.3",
    info: {
      ...(core?.info ?? {}),
      title: "Termix API",
      version,
      description:
        "Core and the plugins that are on, as this server runs them.",
    },
    servers: [{ url: baseUrl || "/", description: "This Termix server" }],
    paths: { ...(core?.paths ?? {}) },
    tags: [...(core?.tags ?? [])],
    components: structuredClone(core?.components ?? {}),
  };
  const tagNames = new Set(merged.tags!.map((tag) => tag.name));
  for (const { id, spec } of plugins) {
    Object.assign(merged.paths!, ownPaths(id, spec.paths ?? {}));
    for (const tag of spec.tags ?? []) {
      if (!tagNames.has(tag.name)) {
        tagNames.add(tag.name);
        merged.tags!.push(tag);
      }
    }
    for (const [section, entries] of Object.entries(spec.components ?? {})) {
      const into = (merged.components![section] ??= {});
      for (const [name, value] of Object.entries(entries ?? {})) {
        if (!(name in into)) into[name] = value;
      }
    }
  }
  return merged;
}

/** Reads every spec from disk and merges them. */
export function servedSpec(
  plugins: SpecPlugin[],
  baseUrl: string,
  version: string,
  corePath = coreSpecPath(),
): Spec {
  const core = readSpec(corePath);
  const specs = plugins
    .filter((plugin) => plugin.state === "active")
    .map((plugin) => ({
      id: plugin.id,
      spec: readSpec(path.join(plugin.dir, "dist", "openapi.json")),
    }))
    .filter(
      (entry): entry is { id: string; spec: Spec } => entry.spec !== null,
    );
  return mergeSpecs(core, specs, baseUrl, version);
}
