/* eslint-disable react-refresh/only-export-components */
/**
 * Runs one plugin outside the shell, for an embedder that shows a single
 * plugin view in its own frame (the mobile app's web view).
 *
 * The plugin gets the real app object, SDK bridge and registries, so its
 * views behave as they do in the web app. Shell calls go to the embedder.
 */

import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/frontend";
import i18n from "@/i18n/i18n";
import type { PluginSummary } from "@/api/plugins-api";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { Toaster } from "@/components/sonner";
import { SurfaceScope } from "@/components/surface/surface-scope";
import { setPluginThemes } from "@/look/theme-registry";
import { getTabType, type TabRenderProps } from "@/shell/tab-registry";
import { getPanel } from "@/shell/panel-registry";
import { getSSHHosts } from "@/main-axios";
import { sshHostToHost } from "@/sidebar/HostManagerData";
import { hostToSSHHost } from "@/lib/host-to-ssh-host";
import type { Host, Tab } from "@/types/ui-types";
import { createPluginApp } from "./app";
import { installPluginHostBridge } from "./bridge";
import { setFrontendState, setPluginSummaries } from "./plugin-store";
import {
  notifyShellReady,
  resetShellBridge,
  setShellCallbacks,
  setShellHosts,
  shellHost,
} from "./shell-bridge";

export interface FrameTheme {
  /** Also the class put on <html>; the embedder supplies its tokens. */
  id: string;
  mode: "light" | "dark";
}

/** What the plugin asks of the shell, with hosts passed by id. */
export interface FrameShell {
  openTab: (
    hostId: string | null,
    type: string,
    options?: { label?: string; data?: Record<string, unknown> },
  ) => void;
  openSingletonTab: (
    type: string,
    options?: { label?: string; data?: Record<string, unknown> },
  ) => void;
  connectHost: (hostId: string, type?: string) => void;
  closeTab: () => void;
  renameTab: (label: string) => void;
  openHostEditor?: (draft?: Record<string, unknown>) => void;
}

export interface FrameView {
  /** A registered tab type or panel id. */
  view: string;
  hostId?: string;
  data?: Record<string, unknown>;
}

export interface PluginFrameOptions {
  root: HTMLElement;
  summary: PluginSummary;
  module: {
    activate: (app: never) => unknown;
    deactivate?: () => unknown;
  };
  view: FrameView;
  theme: FrameTheme;
  shell: FrameShell;
  /** The plugin's strings: English, plus one translation when there is one. */
  locales?: {
    language?: string;
    en?: Record<string, unknown>;
    translated?: Record<string, unknown>;
  };
  guest?: boolean;
}

export interface PluginFrame {
  /** The plugin's registered tab types and panels. */
  views: () => { tabs: string[]; panels: string[] };
  setView: (view: FrameView) => void;
  setTheme: (theme: FrameTheme) => void;
  /** Reloads the host list, then remounts the view. */
  reload: () => Promise<void>;
  dispose: () => Promise<void>;
}

const THEME_KEY = "termix-frame-theme";

function themeEntry(theme: FrameTheme) {
  return {
    id: theme.id,
    label: theme.id,
    mode: theme.mode,
    swatch: { background: "", panel: "", text: "" },
  };
}

let applyTheme: ((id: string) => void) | null = null;

function ThemeSync() {
  const { setTheme } = useTheme();
  useEffect(() => {
    applyTheme = (id) => setTheme(id, false);
    return () => {
      applyTheme = null;
    };
  }, [setTheme]);
  return null;
}

function FrameBody({
  view,
  shell,
  version,
}: {
  view: FrameView;
  shell: TabRenderProps["shell"];
  version: number;
}) {
  const [, setTick] = useState(0);
  // Re-render once hosts arrive, so a host view finds its host.
  useEffect(() => {
    const onChange = () => setTick((n) => n + 1);
    window.addEventListener("termix:frame-hosts", onChange);
    return () => window.removeEventListener("termix:frame-hosts", onChange);
  }, []);

  const tab = getTabType(view.view);
  const host = view.hostId ? shellHost(view.hostId) : undefined;
  if (tab) {
    const Component = tab.component;
    const record: Tab = {
      id: `${view.view}-frame`,
      instanceId: `${view.view}-frame`,
      type: view.view,
      label: view.view,
      host,
      data: view.data,
      openedAt: 0,
    } as Tab;
    return (
      <Component
        key={`${view.view}:${view.hostId ?? ""}:${version}`}
        tab={record}
        host={host}
        sshHost={
          host
            ? (hostToSSHHost(host) as unknown as Record<string, unknown>)
            : undefined
        }
        label={view.view}
        isVisible
        isFocusedPane
        inSplit={false}
        handleRef={null}
        shell={shell}
      />
    );
  }
  const panel = getPanel(view.view);
  if (panel) {
    const Component = panel.component;
    return (
      <Component
        key={`${view.view}:${version}`}
        active
        shell={shell}
        setEditing={() => {}}
        placement="left"
      />
    );
  }
  return null;
}

/** Activates the plugin and renders one of its views into `root`. */
export async function startPluginFrame(
  options: PluginFrameOptions,
): Promise<PluginFrame> {
  const { summary, shell: embedder } = options;
  const pluginId = summary.id;

  installPluginHostBridge();
  resetShellBridge();

  const hostId = (host: Host | null | undefined) =>
    host ? String(host.id) : null;
  const shell: TabRenderProps["shell"] = {
    openTab: (host, type, opts) =>
      embedder.openTab(hostId(host), type, {
        label: opts?.label,
        data: opts?.data,
      }),
    openSingletonTab: (type, opts) => embedder.openSingletonTab(type, opts),
    connectHost: (host, type) => {
      const id = hostId(host);
      if (id) embedder.connectHost(id, type);
    },
    closeTab: () => embedder.closeTab(),
    renameTab: (_id, label) => embedder.renameTab(label),
    openRailView: (id) => embedder.openSingletonTab(id),
    closeRailView: () => {},
    openHostEditor: embedder.openHostEditor
      ? (draft) => embedder.openHostEditor?.(draft as Record<string, unknown>)
      : undefined,
  };
  setShellCallbacks(shell);
  setPluginSummaries([summary]);

  try {
    localStorage.setItem(THEME_KEY, options.theme.id);
  } catch {
    // Private mode; the default below still applies.
  }
  setPluginThemes([themeEntry(options.theme)]);

  const locales = options.locales ?? {};
  if (locales.en) {
    i18n.addResourceBundle("en", pluginId, locales.en, true, true);
  }
  if (locales.language && locales.translated) {
    i18n.addResourceBundle(
      locales.language,
      pluginId,
      locales.translated,
      true,
      true,
    );
  }
  if (locales.language) await i18n.changeLanguage(locales.language);

  const manifest = {
    id: pluginId,
    name: summary.name,
    version: summary.version,
    icon: summary.icon,
    dependencies: summary.dependencies,
    optionalDependencies: summary.optionalDependencies,
    contributes: summary.contributes ?? undefined,
  } as unknown as PluginManifest;
  const handle = createPluginApp(pluginId, manifest, summary.contributes, {
    guest: options.guest,
  });
  await options.module.activate(handle.app as never);
  setFrontendState(pluginId, "active");

  const loadHosts = async () => {
    try {
      setShellHosts((await getSSHHosts()).map(sshHostToHost));
    } catch {
      setShellHosts([], true);
    }
    window.dispatchEvent(new Event("termix:frame-hosts"));
  };
  const onHostsChanged = () => void loadHosts();
  window.addEventListener("termix:hosts-changed", onHostsChanged);
  await loadHosts();
  notifyShellReady();

  let view = options.view;
  let theme = options.theme;
  let version = 0;
  const root: Root = createRoot(options.root);
  const render = () =>
    root.render(
      <ThemeProvider defaultTheme={theme.id} storageKey={THEME_KEY}>
        <ThemeSync />
        <SurfaceScope className="h-full">
          <FrameBody view={view} shell={shell} version={version} />
        </SurfaceScope>
        <Toaster position="top-center" closeButton duration={4000} />
      </ThemeProvider>,
    );
  render();

  const mine = <T extends { pluginId?: string; id: string }>(items: T[]) =>
    items.filter((item) => item.pluginId === pluginId).map((item) => item.id);

  return {
    views: () => {
      const tabs = summary.contributes?.tabs ?? [];
      const panels = summary.contributes?.panels ?? [];
      return {
        tabs: mine(
          tabs.map((entry) => getTabType(entry.id)).filter((def) => !!def) as {
            id: string;
            pluginId?: string;
          }[],
        ),
        panels: mine(
          panels.map((entry) => getPanel(entry.id)).filter((def) => !!def) as {
            id: string;
            pluginId?: string;
          }[],
        ),
      };
    },
    setView: (next) => {
      view = next;
      render();
    },
    setTheme: (next) => {
      theme = next;
      setPluginThemes([themeEntry(next)]);
      applyTheme?.(next.id);
    },
    reload: async () => {
      await loadHosts();
      version += 1;
      render();
    },
    dispose: async () => {
      window.removeEventListener("termix:hosts-changed", onHostsChanged);
      root.unmount();
      try {
        await options.module.deactivate?.();
      } finally {
        handle.dispose();
        setFrontendState(pluginId, "inactive");
        resetShellBridge();
      }
    },
  };
}
