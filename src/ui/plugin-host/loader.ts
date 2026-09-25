import type { ResourceKey } from "i18next";
import type {
  FrontendModule,
  PluginManifest,
} from "@termix/plugin-sdk/frontend";
import i18n, { setPluginLocaleResolver } from "@/i18n/i18n";
import { getPlugins, type PluginSummary } from "@/api/plugins-api";
import { getBackendUrl } from "@/main-axios";
import { createPluginApp, type PluginAppHandle } from "./app";
import { installPluginHostBridge } from "./bridge";
import {
  getPluginRecord,
  getPluginStoreState,
  markPluginsSettled,
  setFrontendState,
  setPluginSummaries,
} from "./plugin-store";
import { workspaceFrontends, workspaceLocales } from "./workspace-plugins";
import { syncHostPluginsTab } from "@/settings/host-plugins-tab";

/**
 * Loads plugin frontends into the running shell.
 *
 * After login, and whenever plugin state may have changed, it fetches
 * GET /plugins and reconciles: plugins that are now enabled are imported and
 * activated in dependency order, plugins that are no longer enabled are
 * deactivated and everything they registered is removed. No reload either way.
 *
 * A plugin whose import or activate throws is marked failed and cleaned up;
 * the others carry on.
 */

interface ActivePlugin {
  id: string;
  assetVersion: string | null;
  handle: PluginAppHandle;
  module: FrontendModule;
  cssLink: HTMLLinkElement | null;
}

export interface PluginLoaderDeps {
  fetchPlugins: () => Promise<PluginSummary[]>;
  importFrontend: (summary: PluginSummary) => Promise<FrontendModule>;
  loadLocale: (
    summary: PluginSummary,
    file: string,
  ) => Promise<ResourceKey | null>;
  /** Adds the plugin stylesheet; returns the element to remove later. */
  injectCss: (summary: PluginSummary) => HTMLLinkElement | null;
}

const active = new Map<string, ActivePlugin>();
/** Bundle version that failed, so the same broken bundle is not retried. */
const failedVersions = new Map<string, string | null>();
let queue: Promise<void> = Promise.resolve();
let deps: PluginLoaderDeps | null = null;
let started = false;
let guestMode = false;

function assetUrl(summary: PluginSummary, file: string): string {
  const version = summary.assetVersion
    ? `?v=${encodeURIComponent(summary.assetVersion)}`
    : "";
  return getBackendUrl(
    `/plugin-assets/${encodeURIComponent(summary.id)}/${file}${version}`,
  );
}

/** Absolute URL, so import() resolves it against the page, not this module. */
function absolute(url: string): string {
  return new URL(url, window.location.href).href;
}

const defaultDeps: PluginLoaderDeps = {
  fetchPlugins: getPlugins,

  async importFrontend(summary) {
    const workspace = workspaceFrontends[summary.id];
    if (workspace) return (await workspace()) as FrontendModule;
    return (await import(
      /* @vite-ignore */ absolute(assetUrl(summary, "frontend.js"))
    )) as FrontendModule;
  },

  async loadLocale(summary, file) {
    const workspace = workspaceLocales[summary.id]?.[file];
    if (workspace) return (await workspace()) as ResourceKey;
    const hasFile = summary.locales?.includes(file);
    if (!hasFile) return null;
    const path = file === "en" ? "en.json" : `translated/${file}.json`;
    const response = await fetch(
      absolute(assetUrl(summary, `locales/${path}`)),
    );
    if (!response.ok) return null;
    return (await response.json()) as ResourceKey;
  },

  injectCss(summary) {
    if (!summary.css || typeof document === "undefined") return null;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = absolute(assetUrl(summary, "frontend.css"));
    link.dataset.plugin = summary.id;
    document.head.appendChild(link);
    return link;
  },
};

function currentDeps(): PluginLoaderDeps {
  return deps ?? defaultDeps;
}

/** Test seam: swaps how plugins are fetched, imported and localized. */
export function configurePluginLoader(next: Partial<PluginLoaderDeps>): void {
  deps = { ...defaultDeps, ...next };
}

function serverAllowsFrontend(summary: PluginSummary): boolean {
  return (
    summary.enabled &&
    summary.state !== "failed" &&
    summary.state !== "blocked" &&
    !!summary.frontend
  );
}

/**
 * Enabled plugins in an order where each comes after its dependencies. A
 * cycle or a missing hard dependency leaves the plugin out, marked blocked.
 */
export function orderForActivation(summaries: PluginSummary[]): {
  order: PluginSummary[];
  blocked: Map<string, string>;
} {
  const byId = new Map(summaries.map((summary) => [summary.id, summary]));
  const order: PluginSummary[] = [];
  const blocked = new Map<string, string>();
  const state = new Map<string, "visiting" | "done">();

  const visit = (summary: PluginSummary): boolean => {
    const mark = state.get(summary.id);
    if (mark === "done") return !blocked.has(summary.id);
    if (mark === "visiting") {
      blocked.set(summary.id, "dependency cycle");
      return false;
    }
    state.set(summary.id, "visiting");

    for (const dependency of Object.keys(summary.dependencies ?? {})) {
      const target = byId.get(dependency);
      if (!target || !serverAllowsFrontend(target) || !visit(target)) {
        blocked.set(summary.id, `needs ${dependency}`);
      }
    }
    for (const dependency of Object.keys(summary.optionalDependencies ?? {})) {
      const target = byId.get(dependency);
      if (target && serverAllowsFrontend(target)) visit(target);
    }

    state.set(summary.id, "done");
    if (blocked.has(summary.id)) return false;
    order.push(summary);
    return true;
  };

  for (const summary of summaries) {
    if (serverAllowsFrontend(summary)) visit(summary);
  }
  return { order, blocked };
}

async function deactivate(pluginId: string): Promise<void> {
  const plugin = active.get(pluginId);
  if (!plugin) return;
  active.delete(pluginId);
  try {
    await plugin.module.deactivate?.();
  } catch (error) {
    console.error(`[plugins] ${pluginId}: deactivate threw`, error);
  }
  // Runs even when deactivate threw or does not exist.
  plugin.handle.dispose();
  plugin.cssLink?.remove();
  setFrontendState(pluginId, "inactive");
}

const ACTIVATE_TIMEOUT_MS = 15_000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function activate(summary: PluginSummary): Promise<void> {
  const loader = currentDeps();
  setFrontendState(summary.id, "loading");

  let cssLink: HTMLLinkElement | null = null;
  let handle: PluginAppHandle | null = null;
  try {
    const module = await loader.importFrontend(summary);
    if (typeof module?.activate !== "function") {
      throw new Error("frontend entry does not export activate(app)");
    }
    cssLink = loader.injectCss(summary);
    handle = createPluginApp(
      summary.id,
      manifestFor(summary),
      summary.contributes,
      { guest: guestMode },
    );
    // A plugin whose activate never settles would hold up every plugin
    // queued after it, so it fails instead.
    await withTimeout(
      Promise.resolve(module.activate(handle.app)),
      ACTIVATE_TIMEOUT_MS,
      `activate() did not finish within ${ACTIVATE_TIMEOUT_MS / 1000}s`,
    );
    active.set(summary.id, {
      id: summary.id,
      assetVersion: summary.assetVersion ?? null,
      handle,
      module,
      cssLink,
    });
    failedVersions.delete(summary.id);
    setFrontendState(summary.id, "active");
  } catch (error) {
    // A failed activate is still cleaned up, and its deactivate is not
    // called: it never finished starting.
    handle?.dispose();
    cssLink?.remove();
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[plugins] ${summary.id} failed to start`, error);
    failedVersions.set(summary.id, summary.assetVersion ?? null);
    setFrontendState(summary.id, "failed", message);
  }
}

/** The manifest subset the browser has. The full one stays on the server. */
function manifestFor(summary: PluginSummary): PluginManifest {
  return {
    id: summary.id,
    name: summary.name,
    version: summary.version,
    description: "",
    author: { name: "" },
    license: "",
    category: "",
    engine: { termix: "", api: "1" },
    capabilities: summary.capabilities ?? [],
    dependencies: summary.dependencies,
    optionalDependencies: summary.optionalDependencies,
    contributes: summary.contributes as PluginManifest["contributes"],
    icon: summary.icon,
  };
}

async function loadNamespaces(summaries: PluginSummary[]): Promise<void> {
  const ids = summaries.map((summary) => summary.id);
  if (ids.length === 0) return;
  // Reloading picks up a plugin that was upgraded while the app was open.
  await i18n.reloadResources(undefined, ids).catch(() => {});
  await i18n.loadNamespaces(ids).catch(() => {});
}

async function reconcile(summaries: PluginSummary[]): Promise<void> {
  setPluginSummaries(summaries);
  // The host editor's Plugins tab exists only while something fills it.
  syncHostPluginsTab(summaries);
  await loadNamespaces(summaries);

  const { order, blocked } = orderForActivation(summaries);
  const wanted = new Map(order.map((summary) => [summary.id, summary]));

  // Dependents go first, so nothing outlives what it depends on.
  for (const id of [...active.keys()].reverse()) {
    const next = wanted.get(id);
    const current = active.get(id)!;
    if (!next || (next.assetVersion ?? null) !== current.assetVersion) {
      await deactivate(id);
    }
  }

  for (const [id, reason] of blocked) {
    if (getPluginRecord(id)?.frontend !== "blocked") {
      setFrontendState(id, "blocked", reason);
    }
  }

  // A plugin that was switched off gets a fresh attempt when it comes back.
  for (const id of [...failedVersions.keys()]) {
    if (!wanted.has(id)) failedVersions.delete(id);
  }

  await activateConcurrently(order);
}

/**
 * Activates every plugin in `order`, running independent plugins in
 * parallel instead of one at a time. Each plugin still waits for its own
 * hard dependencies to finish activating first (success or failure - a
 * blocked or failed dependency must not hang its dependents forever).
 */
async function activateConcurrently(order: PluginSummary[]): Promise<void> {
  const byId = new Map(order.map((summary) => [summary.id, summary]));
  const started = new Map<string, Promise<void>>();

  const run = (summary: PluginSummary): Promise<void> => {
    const existing = started.get(summary.id);
    if (existing) return existing;

    const task = (async () => {
      const dependencyIds = Object.keys(summary.dependencies ?? {});
      await Promise.all(
        dependencyIds.map((id) => {
          const dependency = byId.get(id);
          return dependency ? run(dependency) : Promise.resolve();
        }),
      );

      if (active.has(summary.id)) return;
      // Do not retry a bundle that already failed until it changes.
      if (
        failedVersions.has(summary.id) &&
        failedVersions.get(summary.id) === (summary.assetVersion ?? null)
      ) {
        setFrontendState(
          summary.id,
          "failed",
          getPluginRecord(summary.id)?.error,
        );
        return;
      }
      await activate(summary);
    })();

    started.set(summary.id, task);
    return task;
  };

  await Promise.all(order.map(run));
}

function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task, task);
  return queue;
}

/**
 * Fetches plugin state and brings the loaded frontends in line with it. Safe
 * to call as often as needed; calls run one after another.
 */
export function syncPlugins(summaries?: PluginSummary[]): Promise<void> {
  return enqueue(async () => {
    let list = summaries;
    if (!list) {
      try {
        list = await currentDeps().fetchPlugins();
      } catch (error) {
        console.error("[plugins] could not load the plugin list", error);
        // The shell must not wait on plugins forever.
        if (!getPluginStoreState().loaded) setPluginSummaries([]);
        markPluginsSettled();
        return;
      }
    }
    await reconcile(list);
    markPluginsSettled();
  });
}

/** Fired by anything that changes plugin state, e.g. the admin toggle. */
const PLUGINS_CHANGED_EVENT = "termix:plugins-changed";

let lastFocusSync = 0;
const FOCUS_SYNC_INTERVAL_MS = 30_000;

function onPluginsChanged() {
  void syncPlugins();
}

function onFocus() {
  const now = Date.now();
  if (now - lastFocusSync < FOCUS_SYNC_INTERVAL_MS) return;
  lastFocusSync = now;
  void syncPlugins();
}

async function fetchGuestPlugins(): Promise<PluginSummary[]> {
  const response = await fetch(getBackendUrl("/plugins/public"));
  if (!response.ok) return [];
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as PluginSummary[]) : [];
}

let guestViewsRequest: Promise<string[]> | null = null;

/**
 * The `?view=` names enabled guest plugins serve to anonymous pages, so the
 * entry point can tell a guest link from a signed-in full-screen view
 * without knowing any plugin.
 */
export function fetchGuestViews(): Promise<string[]> {
  guestViewsRequest ??= fetchGuestPlugins()
    .then((plugins) =>
      plugins.flatMap(
        (plugin) =>
          (plugin.contributes as { guestViews?: string[] } | undefined)
            ?.guestViews ?? [],
      ),
    )
    .catch(() => []);
  return guestViewsRequest;
}

async function fetchPreLoginPlugins(): Promise<PluginSummary[]> {
  const response = await fetch(getBackendUrl("/plugins/public-manifest"));
  if (!response.ok) return [];
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as PluginSummary[]) : [];
}

/**
 * Loads the plugins the login screen needs (login methods and second
 * factors) before anyone has signed in. After sign-in the full runtime
 * reconciles, keeping these active when their bundle has not changed.
 */
export async function startPreLoginPlugins(): Promise<void> {
  installPluginHostBridge();
  let list: PluginSummary[];
  try {
    list = await fetchPreLoginPlugins();
  } catch {
    return;
  }
  if (list.length === 0) return;
  setPluginLocaleResolver((namespace, _language, file) => {
    const summary = getPluginRecord(namespace)?.summary;
    if (!summary) return Promise.resolve(null);
    return currentDeps().loadLocale(summary, file);
  });
  await syncPlugins(list);
}

/**
 * Starts the runtime. Idempotent. `guest` is for anonymous pages (shared
 * session links): only plugins declaring contributes.guest load, from the
 * public list, and nothing is refetched on focus.
 */
export function startPluginRuntime(
  options: { guest?: boolean } = {},
): Promise<void> {
  installPluginHostBridge();
  if (options.guest) {
    guestMode = true;
    if (!deps) configurePluginLoader({ fetchPlugins: fetchGuestPlugins });
    return syncPlugins();
  }
  setPluginLocaleResolver((namespace, _language, file) => {
    const summary = getPluginRecord(namespace)?.summary;
    if (!summary) return Promise.resolve(null);
    return currentDeps().loadLocale(summary, file);
  });

  if (!started && typeof window !== "undefined") {
    started = true;
    lastFocusSync = Date.now();
    window.addEventListener(PLUGINS_CHANGED_EVENT, onPluginsChanged);
    window.addEventListener("focus", onFocus);
  }
  return syncPlugins();
}

/** Deactivates every plugin, on logout. */
export function stopPluginRuntime(): Promise<void> {
  if (started && typeof window !== "undefined") {
    started = false;
    window.removeEventListener(PLUGINS_CHANGED_EVENT, onPluginsChanged);
    window.removeEventListener("focus", onFocus);
  }
  return enqueue(async () => {
    for (const id of [...active.keys()].reverse()) await deactivate(id);
  });
}

export function isPluginFrontendActive(pluginId: string): boolean {
  return active.has(pluginId);
}

/** Test seam. */
export async function resetPluginLoader(): Promise<void> {
  await stopPluginRuntime();
  deps = null;
  queue = Promise.resolve();
  failedVersions.clear();
}
