/**
 * The page a plugin view runs in, loaded by frame-main once the shims are
 * in. The page sits at /plugin-assets/<id>/_frame/frame.html inside an iframe
 * with sandbox="allow-scripts", so it has an opaque origin and no cookies.
 *
 * It says hello to the shell, gets its boot data, loads the plugin's bundle
 * from the folder above, runs activate(app) and then either keeps the
 * plugin's background work going (background frame) or draws one view.
 */

import "./frame.css";
import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import axios, { type AxiosInstance } from "axios";
import {
  __setPluginHost,
  type FrontendModule,
  type PluginManifest,
  type TabsApi,
} from "@termix-ssh/plugin-sdk/frontend";
import i18n, { setPluginLocaleResolver } from "@/i18n/i18n";
import { setFrameTransport } from "@/lib/plugin-transport";
import { setPluginSummaries } from "@/plugin-host/plugin-store";
import type { PluginSummary } from "@/api/plugins-api";
import { setPluginThemes } from "@/look/theme-registry";
import { websocketAuthProtocols } from "@/lib/ws-auth";
import {
  FRAME_CHANNEL,
  type FrameInit,
  type FrameMessage,
  type FrameRole,
  type FrameState,
  type FrameTheme,
} from "./protocol";
import { FramePort } from "./rpc";
import { createFrameFetch, createFrameXhr } from "./net";
import { connectShims, frameLocalStorage } from "./shims";
import {
  createFrameApp,
  frameComponent,
  frameComponentKeys,
} from "./frame-app";
import { createFrameBridge } from "./frame-bridge";
import { getFrameState, setFrameState } from "./frame-store";
import { FrameHooks } from "./frame-hooks";
import { withPluginScope } from "@/plugin-host/scope";
import { FrameRoot, setFrameProps, type FrameFit } from "./frame-root";

interface BootParams {
  role: FrameRole;
  key?: string;
  fit: FrameFit;
  transparent: boolean;
}

/**
 * The background frame covers the window only while it shows something (a
 * dialog an overlay opened), so it never blocks clicks otherwise.
 */
function watchOverlay(report: (active: boolean) => void) {
  let last = false;
  const check = () => {
    const root = document.getElementById("root");
    const portals = [...document.body.children].some(
      (child) =>
        child !== root &&
        !(child instanceof HTMLScriptElement) &&
        child.childElementCount > 0,
    );
    const drawn = !!root && root.querySelector("[role=dialog],[data-overlay]");
    const active = portals || !!drawn;
    if (active === last) return;
    last = active;
    report(active);
  };
  new MutationObserver(check).observe(document.body, {
    childList: true,
    subtree: true,
  });
  check();
}

function readParams(): BootParams {
  const params = new URLSearchParams(location.hash.slice(1));
  const role = params.get("role") === "background" ? "background" : "view";
  const fit: FrameFit =
    params.get("inline") === "1"
      ? "inline"
      : params.get("fit") === "content"
        ? "content"
        : "fill";
  return {
    role,
    key: params.get("key") ?? undefined,
    fit,
    transparent: params.get("bg") === "none",
  };
}

function applyTheme(theme: FrameTheme) {
  const root = document.documentElement;
  root.className = theme.className;
  root.setAttribute("style", theme.style);
  let node = document.getElementById("termix-theme-css");
  if (!node) {
    node = document.createElement("style");
    node.id = "termix-theme-css";
    document.head.appendChild(node);
  }
  node.textContent = theme.css.join("\n");
  setPluginThemes([
    {
      id: theme.themeId,
      label: theme.themeId,
      mode: theme.mode,
      swatch: { background: "", panel: "", text: "" },
    },
  ]);
}

async function boot() {
  const params = readParams();
  const parent = window.parent;
  if (!parent || parent === window) return;
  document.documentElement.dataset.frameFit =
    params.fit === "fill" ? "fill" : "content";
  if (params.transparent) document.documentElement.dataset.frameBg = "none";

  const realFetch = window.fetch.bind(window);
  const port = new FramePort({
    post: (message: FrameMessage) => parent.postMessage(message, "*"),
    onCall: (method, args) => handleShellCall(method, args),
    onEvent: (name, data) => handleShellEvent(name, data),
    fnPrefix: "p",
  });
  window.addEventListener("message", (event) => {
    // Only the shell that holds this frame may talk to it.
    if (event.source !== parent) return;
    port.receive(event.data);
  });

  const call = (method: string, ...args: unknown[]) => port.call(method, args);

  parent.postMessage(
    { ch: FRAME_CHANNEL, t: "hello", role: params.role, key: params.key },
    "*",
  );
  const init = (await port.call("init")) as FrameInit;
  const { pluginId, baseUrl } = init;

  // Token for the plugin's own routes, renewed a minute before it ends.
  let token = init.token;
  let renewing: Promise<string> | null = null;
  const currentToken = async () => {
    if (token.expiresAt - Date.now() > 60_000) return token.value;
    renewing ??= (port.call("token") as Promise<FrameInit["token"]>)
      .then((next) => {
        token = next;
        return next.value;
      })
      .finally(() => {
        renewing = null;
      });
    return renewing;
  };

  frameLocalStorage.load(init.storage);
  connectShims({
    saveStorage: (name, value) => port.emit("storage", { key: name, value }),
    openUrl: (url) => void port.call("openUrl", [url]),
    download: (blob, name) => void port.call("download", [blob, name]),
    writeClipboard: async (text) => {
      await port.call("clipboard.write", [text]);
    },
    readClipboard: async () =>
      String((await port.call("clipboard.read", [])) ?? ""),
  });

  const frameFetch = createFrameFetch({
    pluginId,
    baseUrl,
    token: currentToken,
    realFetch,
    coreRequest: (request) =>
      port.call("http", [request]) as ReturnType<
        Parameters<typeof createFrameFetch>[0]["coreRequest"]
      >,
  });
  window.fetch = frameFetch;
  window.XMLHttpRequest = createFrameXhr(frameFetch);

  const apiRoot = `${baseUrl.replace(/\/+$/, "")}/plugin-api/${pluginId}`;
  const api: AxiosInstance = axios.create({
    baseURL: apiRoot,
    withCredentials: false,
    headers: { "Content-Type": "application/json" },
  });
  api.interceptors.request.use(async (config) => {
    config.headers.set("Authorization", `Bearer ${await currentToken()}`);
    return config;
  });
  const ownOnly = (id: string) => {
    if (id !== pluginId) {
      throw new Error("A plugin view can only reach its own plugin");
    }
  };
  const pluginFetch = (path: string, init: RequestInit = {}) =>
    frameFetch(`${apiRoot}${path.startsWith("/") ? path : `/${path}`}`, init);
  const wsUrl = async (path: string) => ({
    url: `${baseUrl.replace(/^http/, "ws").replace(/\/+$/, "")}/plugin-ws/${pluginId}${path.startsWith("/") ? path : `/${path}`}`,
    protocols: websocketAuthProtocols(await currentToken()),
  });
  setFrameTransport({
    api: (id) => {
      ownOnly(id);
      return api;
    },
    fetch: (id, path, init) => {
      ownOnly(id);
      return pluginFetch(path, init);
    },
    wsUrl: (id, path) => {
      ownOnly(id);
      return wsUrl(path);
    },
  });

  setFrameState(init.state as FrameState);
  if (init.props) setFrameProps(init.props);
  applyTheme(init.state.theme);

  const manifest = init.manifest as unknown as PluginManifest;
  setPluginSummaries([
    ...init.pluginIds
      .filter((id) => id !== pluginId)
      .map((id) => ({ id, name: id }) as unknown as PluginSummary),
    {
      id: pluginId,
      name: String(manifest.name ?? pluginId),
      version: String(manifest.version ?? ""),
      enabled: true,
      state: "active",
      frontend: true,
      docs: (manifest as { docs?: unknown }).docs,
      contributes: manifest.contributes ?? null,
      locales: init.locales,
    } as unknown as PluginSummary,
  ]);

  const assetRoot = `${baseUrl.replace(/\/+$/, "")}/plugin-assets/${pluginId}/`;
  const version = init.assetVersion
    ? `?v=${encodeURIComponent(init.assetVersion)}`
    : "";
  setPluginLocaleResolver(async (namespace, _language, file) => {
    if (namespace !== pluginId || !init.locales.includes(file)) return null;
    const path = file === "en" ? "en.json" : `translated/${file}.json`;
    const response = await realFetch(`${assetRoot}locales/${path}${version}`, {
      credentials: "omit",
    });
    return response.ok ? await response.json() : null;
  });
  await i18n.changeLanguage(init.language).catch(() => {});
  await i18n.loadNamespaces([pluginId]).catch(() => {});

  const tabs: TabsApi = {
    openTab: (target, type, options) =>
      void call(
        "tabs.openTab",
        target ? String(target.id) : null,
        type,
        options,
      ),
    openSingletonTab: (type, options) =>
      void call("tabs.openSingletonTab", type, options),
    connectHost: (target, type) =>
      void call("tabs.connectHost", String(target.id), type),
    closeTab: (tabId) => void call("tabs.closeTab", tabId),
    openRailView: (id) => void call("tabs.openRailView", id),
    getLayout: () => getFrameState().layout as ReturnType<TabsApi["getLayout"]>,
    applyLayout: (layout, options) =>
      call("tabs.applyLayout", layout, options) as Promise<{
        skipped: string[];
      }>,
    onChange: () => () => {},
    onReady: () => () => {},
  };

  __setPluginHost(
    createFrameBridge({
      pluginId,
      call,
      getApi: (id) => {
        ownOnly(id);
        return api as never;
      },
      tabs,
      devReads: init.devReads === true,
    }),
  );

  if (init.css) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${assetRoot}frontend.css${version}`;
    document.head.appendChild(link);
  }

  const module = (await import(
    /* @vite-ignore */ `${assetRoot}frontend.js${version}`
  )) as FrontendModule;
  if (typeof module?.activate !== "function") {
    throw new Error("frontend entry does not export activate(app)");
  }

  const handle = createFrameApp({
    pluginId,
    role: params.role,
    manifest,
    register: (rid, kind, data) => port.emit("register", { rid, kind, data }),
    unregister: (rid) => port.emit("unregister", { rid }),
    call,
    api: api as never,
    fetch: pluginFetch,
    wsUrl: wsUrl as never,
  });
  await module.activate(handle.app);

  window.addEventListener("pagehide", () => {
    void Promise.resolve(module.deactivate?.()).finally(() => handle.dispose());
  });

  const mount = document.getElementById("root")!;
  const root = createRoot(mount);
  // The plugin's shell.overlay parts (dialogs it opens from anywhere) live
  // in the background frame, beside the code that opens them.
  const overlays = () =>
    frameComponentKeys("slot:shell.overlay:").map((key) =>
      createElement(frameComponent(key)!, { key }),
    );
  if (params.role === "background") {
    root.render(
      createElement(FrameRoot, {
        fit: "fill",
        children: [
          createElement(withPluginScope(pluginId, FrameHooks), {
            key: "hooks",
            send: (key: string, value: unknown) =>
              port.emit("value", { key, value }),
          }),
          ...overlays(),
        ],
      }),
    );
    watchOverlay((active) => port.emit("overlay", { active }));
  } else {
    const component = params.key ? frameComponent(params.key) : undefined;
    if (!component) {
      throw new Error(`${pluginId} has no view "${params.key ?? ""}"`);
    }
    root.render(
      createElement(FrameRoot, {
        fit: params.fit,
        component: component as ComponentType<Record<string, unknown>>,
        onSize: (size: { width: number; height: number }) =>
          port.emit("size", size),
      }),
    );
  }
  port.emit("ready");

  // Settings saved in this frame: the shell and the plugin's other frames
  // read them again.
  window.addEventListener("termix:plugin-settings-changed", (event) => {
    const detail = (event as CustomEvent).detail as {
      scope?: string;
      hostId?: number;
      fromShell?: boolean;
    } | null;
    if (!detail || detail.fromShell) return;
    port.emit("settingsChanged", {
      scope: detail.scope,
      hostId: detail.hostId,
    });
  });

  // The shell's shortcuts still work while focus is in a view: keys the
  // plugin left alone go up to the shell.
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    const fnKey = /^F\d{1,2}$/.test(event.key);
    if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !fnKey &&
      event.key !== "Escape"
    ) {
      return;
    }
    port.emit("key", {
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    });
  });
  window.addEventListener("focus", () => port.emit("focus"));
  window.addEventListener("pointerdown", () => port.emit("pointer"), true);

  function handleShellCall(method: string, args: unknown[]): unknown {
    void method;
    void args;
    throw new Error("Unknown call");
  }

  function handleShellEvent(name: string, data: unknown) {
    if (name === "state" && data && typeof data === "object") {
      const next = data as Partial<FrameState>;
      setFrameState(next);
      if (next.theme) applyTheme(next.theme);
      return;
    }
    if (name === "props" && data && typeof data === "object") {
      setFrameProps(data as Record<string, unknown>);
      return;
    }
    if (name === "settingsChanged" && data && typeof data === "object") {
      window.dispatchEvent(
        new CustomEvent("termix:plugin-settings-changed", {
          detail: { ...(data as object), pluginId, fromShell: true },
        }),
      );
      return;
    }
    if (name === "language" && typeof data === "string") {
      void i18n.changeLanguage(data);
    }
  }
}

boot().catch((error) => {
  console.error("[plugin frame] failed to start", error);
  try {
    window.parent.postMessage(
      {
        ch: FRAME_CHANNEL,
        t: "event",
        name: "failed",
        data: error instanceof Error ? error.message : String(error),
      },
      "*",
    );
  } catch {
    // Nobody to tell.
  }
});
