/**
 * What a user can do right now, in their language.
 *
 * Built from the manifests of running plugins, never from GET /plugins, which
 * hands every signed-in user the raw manifest. A plugin's locale file loads
 * here on the server, because its frontend may not be loaded on the client:
 * the CLI has no frontend, and a linked desktop may not have the plugin at all.
 */

import fs from "node:fs";
import path from "node:path";
import {
  matchesWhen,
  onSurface,
  toJsonSchema,
  type OperationAction,
  type OperationEvent,
  type OperationField,
  type OperationResource,
  type OperationSignal,
  type OperationSurfaces,
} from "@termix-ssh/plugin-sdk/operations";
import { settingsFor } from "./hosts.js";
import { getAction } from "./registry.js";
import { qualifyPermission, type PluginManifest } from "../plugins/manifest.js";
import { PermissionManager } from "../utils/permission-manager.js";

interface CatalogPlugin {
  id: string;
  dir: string;
  manifest: PluginManifest;
  state: string;
  official: boolean;
}

export interface CatalogField extends OperationField {
  label: string;
  description?: string;
  placeholder?: string;
  optionLabels?: Record<string, string>;
}

export interface CatalogAction extends Omit<
  OperationAction,
  "inputs" | "outputs"
> {
  pluginId: string;
  pluginName: string;
  official: boolean;
  title: string;
  description?: string;
  inputs: CatalogField[];
  outputs: CatalogField[];
  inputSchema: Record<string, unknown>;
  available: boolean;
  /**
   * For a host or resource action with `when`: the user's hosts it fits.
   * Plugins only see their own host settings, so a client can't work it out.
   */
  hostIds?: number[];
}

export interface CatalogEvent extends OperationEvent {
  pluginId: string;
  title: string;
}

export interface CatalogResource extends OperationResource {
  pluginId: string;
  title: string;
  columns: (NonNullable<OperationResource["columns"]>[number] & {
    title: string;
  })[];
}

export interface CatalogSignal extends OperationSignal {
  pluginId: string;
  title: string;
}

export interface OperationCatalog {
  actions: CatalogAction[];
  events: CatalogEvent[];
  resources: CatalogResource[];
  signals: CatalogSignal[];
}

type Strings = Record<string, string>;

const localeCache = new Map<string, Strings>();

function flatten(value: unknown, prefix: string, out: Strings): void {
  if (typeof value === "string") {
    out[prefix] = value;
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    flatten(child, prefix ? `${prefix}.${key}` : key, out);
  }
}

function readLocale(file: string): Strings {
  const out: Strings = {};
  try {
    flatten(JSON.parse(fs.readFileSync(file, "utf8")), "", out);
  } catch {
    // A missing or broken file falls back to the key.
  }
  return out;
}

/** Locale names reach a path, so only a plain language tag is used. */
function safeLanguage(lang: string | undefined): string {
  return lang && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(lang) ? lang : "en";
}

function stringsFor(plugin: CatalogPlugin, lang: string): Strings {
  const cacheKey = `${plugin.id}@${plugin.manifest.version}:${lang}`;
  const cached = localeCache.get(cacheKey);
  if (cached) return cached;

  const dir = path.resolve(plugin.dir, plugin.manifest.locales ?? "locales");
  const strings = readLocale(path.join(dir, "en.json"));
  if (lang !== "en") {
    Object.assign(
      strings,
      readLocale(path.join(dir, "translated", `${lang}.json`)),
      readLocale(path.join(dir, `${lang}.json`)),
    );
  }
  localeCache.set(cacheKey, strings);
  return strings;
}

function localizedField(field: OperationField, strings: Strings): CatalogField {
  const text = (key?: string) => (key ? (strings[key] ?? key) : undefined);
  const optionLabels: Record<string, string> = {};
  for (const option of field.options ?? []) {
    optionLabels[option.value] = text(option.labelKey) ?? option.value;
  }
  return {
    ...field,
    label: text(field.labelKey) ?? field.key,
    description: text(field.descriptionKey),
    placeholder: text(field.placeholderKey),
    optionLabels: field.options ? optionLabels : undefined,
  };
}

async function runningPlugins(): Promise<CatalogPlugin[]> {
  const { getPluginRuntime } = await import("../plugins/index.js");
  return getPluginRuntime()
    .loader.list()
    .filter((plugin) => plugin.state === "active")
    .map((plugin) => ({
      id: plugin.id,
      dir: plugin.dir,
      manifest: plugin.manifest,
      state: plugin.state,
      official: plugin.source === "bundled" || plugin.signedTier === "official",
    }));
}

export async function buildCatalog(options: {
  userId: string;
  lang?: string;
  surface?: keyof OperationSurfaces;
}): Promise<OperationCatalog> {
  const lang = safeLanguage(options.lang);
  const permissions = PermissionManager.getInstance();
  const catalog: OperationCatalog = {
    actions: [],
    events: [],
    resources: [],
    signals: [],
  };

  // The user's hosts, loaded once and only when some action has a `when`.
  let targets: number[] | null = null;
  const userHosts = async () => {
    if (!targets) {
      const { loadProbeTargets } = await import("../plugins/ctx-probe.js");
      targets = (await loadProbeTargets(options.userId)).map((t) => t.id);
    }
    return targets;
  };

  for (const plugin of await runningPlugins()) {
    const operations = plugin.manifest.contributes?.operations;
    if (!operations) continue;
    // Each host's settings for this plugin, read once for all its actions.
    let hostSettings: Map<number, Record<string, unknown>> | null = null;
    const fittingHosts = async (when: OperationAction["when"]) => {
      if (!hostSettings) {
        hostSettings = new Map();
        for (const id of await userHosts()) {
          hostSettings.set(id, await settingsFor(plugin.manifest, id));
        }
      }
      return [...hostSettings]
        .filter(([, settings]) => matchesWhen(when, { settings }))
        .map(([id]) => id);
    };
    const strings = stringsFor(plugin, lang);
    const text = (key: string) => strings[key] ?? key;

    for (const action of operations.actions ?? []) {
      if (options.surface && !onSurface(action, options.surface)) continue;
      // Community plugins stay away from the assistant and MCP until an admin allows them.
      if (
        !plugin.official &&
        (options.surface === "assistant" || options.surface === "mcp")
      ) {
        continue;
      }
      const permission = qualifyPermission(plugin.id, action.permission);
      if (!(await permissions.hasPermission(options.userId, permission))) {
        continue;
      }
      const inputs = (action.inputs ?? []).map((field) =>
        localizedField(field, strings),
      );
      catalog.actions.push({
        ...action,
        pluginId: plugin.id,
        pluginName: plugin.manifest.name,
        official: plugin.official,
        title: text(action.titleKey),
        description: action.descriptionKey
          ? text(action.descriptionKey)
          : undefined,
        inputs,
        outputs: (action.outputs ?? [])
          .filter((field) => !field.sensitive)
          .map((field) => localizedField(field, strings)),
        inputSchema: toJsonSchema(
          action.inputs,
          (field) =>
            inputs.find((input) => input.key === field.key)?.description,
        ),
        available: getAction(action.id) !== undefined,
        hostIds:
          action.when && action.scope !== "server"
            ? await fittingHosts(action.when)
            : undefined,
      });
    }

    const visible = new Set(catalog.actions.map((action) => action.id));
    for (const event of operations.events ?? []) {
      catalog.events.push({
        ...event,
        pluginId: plugin.id,
        title: text(event.titleKey),
      });
    }
    for (const resource of operations.resources ?? []) {
      if (!visible.has(resource.list)) continue;
      catalog.resources.push({
        ...resource,
        pluginId: plugin.id,
        title: text(resource.titleKey),
        columns: (resource.columns ?? []).map((column) => ({
          ...column,
          title: text(column.titleKey),
        })),
      });
    }
    for (const signal of operations.signals ?? []) {
      if (!visible.has(signal.read)) continue;
      catalog.signals.push({
        ...signal,
        pluginId: plugin.id,
        title: text(signal.titleKey),
      });
    }
  }
  return catalog;
}

/** Test seam. */
export function clearCatalogCache(): void {
  localeCache.clear();
}
