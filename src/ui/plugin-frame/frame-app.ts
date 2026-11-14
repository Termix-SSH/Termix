/**
 * The app object a framed plugin's activate(app) gets.
 *
 * Every frame of a plugin runs activate. Components stay in the frame under a
 * stable key; the background frame also reports each registration to the
 * shell as plain data (icons by name, components by key, functions by
 * reference), and runs the plugin's hooks for badges, dots and defaults,
 * sending their values.
 */

import type { ComponentType } from "react";
import type {
  Disposer,
  PluginManifest,
  TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { pluginDocsPage, pluginDocsUrl } from "@termix-ssh/plugin-sdk/docs";
import i18n from "@/i18n/i18n";
import { pluginKey } from "@/lib/plugin-i18n";
import { withPluginScope } from "@/plugin-host/scope";
import { registerExtension as registerOwnExtension } from "@/plugin-host/extension-registry";
import { resolvePluginPermission } from "@/plugin-host/bridge";
import { hasPermission } from "@/hooks/use-permissions";
import { iconToWire } from "./wire";
import type { FrameRole, WireComponent } from "./protocol";
import { addHook, removeHook, type HookSpec } from "./frame-hooks";
import { getFrameState, subscribeFrameState } from "./frame-store";

/** A plugin component, keyed for the shell to ask for it again. */
const components = new Map<string, ComponentType<Record<string, unknown>>>();

export function frameComponent(
  key: string,
): ComponentType<Record<string, unknown>> | undefined {
  return components.get(key);
}

/** Keys of the plugin's components that start with a prefix, in order. */
export function frameComponentKeys(prefix: string): string[] {
  return [...components.keys()].filter((key) => key.startsWith(prefix));
}

export interface FrameAppHost {
  pluginId: string;
  role: FrameRole;
  manifest: PluginManifest;
  /** Sends a registration to the shell (background frame only). */
  register: (rid: string, kind: string, data: Record<string, unknown>) => void;
  unregister: (rid: string) => void;
  /** Calls the shell. */
  call: (method: string, ...args: unknown[]) => Promise<unknown>;
  api: TermixApp["api"];
  fetch: TermixApp["fetch"];
  wsUrl: TermixApp["wsUrl"];
  /** Something the shell can't show, like an icon that isn't Lucide. */
  warn?: (message: string) => void;
}

/** Things that are the shell itself and never run in a frame. */
const SHELL_PARTS =
  "only official plugins running in the page can provide this";

export function createFrameApp(host: FrameAppHost): {
  app: TermixApp;
  dispose: () => void;
} {
  const { pluginId, manifest } = host;
  const background = host.role === "background";
  const bag: Disposer[] = [];
  let disposed = false;
  let counter = 0;

  const track = (disposer: Disposer): Disposer => {
    if (disposed) {
      try {
        disposer();
      } catch {
        // Never thrown into activate.
      }
      return () => {};
    }
    bag.push(disposer);
    return () => {
      const index = bag.indexOf(disposer);
      if (index >= 0) bag.splice(index, 1);
      disposer();
    };
  };

  const scoped = (component: unknown, componentKey: string): WireComponent => {
    if (typeof component !== "function" && typeof component !== "object") {
      throw new Error(`${pluginId}: ${componentKey} needs a component`);
    }
    components.set(
      componentKey,
      withPluginScope(
        pluginId,
        component as ComponentType<Record<string, unknown>>,
      ),
    );
    return { $component: componentKey };
  };

  const icon = (value: unknown) => {
    const wired = iconToWire(value);
    if (value && !wired) {
      (host.warn ?? console.warn)(
        `${pluginId}: an icon is not a lucide-react icon, so the shell can't show it`,
      );
    }
    return wired;
  };

  /** Records one registration and returns its disposer. */
  const add = (
    kind: string,
    data: Record<string, unknown>,
    options: { componentKeys?: string[]; hooks?: HookSpec[] } = {},
  ): Disposer => {
    const rid = `${kind}#${++counter}`;
    if (background) {
      host.register(rid, kind, data);
      for (const spec of options.hooks ?? []) addHook(spec);
    }
    return track(() => {
      for (const componentKey of options.componentKeys ?? []) {
        components.delete(componentKey);
      }
      if (background) {
        for (const spec of options.hooks ?? []) removeHook(spec.key);
        host.unregister(rid);
      }
    });
  };

  const declared = (list: unknown, id: string) =>
    Array.isArray(list) &&
    list.some(
      (entry) =>
        entry === id ||
        (!!entry &&
          typeof entry === "object" &&
          (entry as { id?: unknown }).id === id),
    );

  const contributes = (manifest.contributes ?? {}) as Record<string, unknown>;

  const requireDeclared = (field: string[], id: string, what: string): void => {
    if (!field.some((name) => declared(contributes[name], id))) {
      throw new Error(
        `${pluginId}: ${what} "${id}" is not declared in manifest contributes.${field[0]}`,
      );
    }
  };

  const app: TermixApp = {
    pluginId,
    manifest,
    guest: false,

    registerRailItem(item) {
      requireDeclared(["panels", "tabs"], item.id, "rail item");
      const { icon: itemIcon, useBadge, useStatus, ...rest } = item;
      const hooks: HookSpec[] = [];
      if (useBadge) {
        hooks.push({ key: `rail:${item.id}:badge`, use: useBadge });
      }
      if (useStatus) {
        hooks.push({ key: `rail:${item.id}:status`, use: useStatus });
      }
      return add(
        "railItem",
        {
          ...rest,
          icon: icon(itemIcon),
          badgeKey: useBadge ? `rail:${item.id}:badge` : undefined,
          statusKey: useStatus ? `rail:${item.id}:status` : undefined,
        },
        { hooks },
      );
    },

    registerPanel(id, component, options) {
      requireDeclared(["panels", "tabs"], id, "panel");
      const componentKey = `panel:${id}`;
      return add(
        "panel",
        {
          id,
          component: scoped(component, componentKey),
          keepMounted: options?.keepMounted,
        },
        { componentKeys: [componentKey] },
      );
    },

    registerTab(type, component, options = {}) {
      requireDeclared(["tabs"], type, "tab type");
      const componentKey = `tab:${type}`;
      const keys = [componentKey];
      const { standalone, icon: tabIcon, ...rest } = options;
      let standaloneRef: WireComponent | undefined;
      if (standalone) {
        keys.push(`tab:${type}:standalone`);
        standaloneRef = scoped(standalone, `tab:${type}:standalone`);
      }
      return add(
        "tab",
        {
          ...rest,
          id: type,
          icon: icon(tabIcon),
          component: scoped(component, componentKey),
          standalone: standaloneRef,
        },
        { componentKeys: keys },
      );
    },

    registerCompanion(id, component, options = {}) {
      const componentKey = `companion:${id}`;
      const { useDefaults, icon: companionIcon, ...rest } = options;
      const hooks: HookSpec[] = useDefaults
        ? [{ key: `companion:${id}:defaults`, use: useDefaults }]
        : [];
      return add(
        "companion",
        {
          ...rest,
          id,
          icon: icon(companionIcon),
          component: scoped(component, componentKey),
          defaultsKey: useDefaults ? `companion:${id}:defaults` : undefined,
        },
        { componentKeys: [componentKey], hooks },
      );
    },

    registerCompanionLayout(tabType, resolve) {
      return add("companionLayout", { tabType, resolve });
    },

    toggleCompanion(tab, id) {
      void host.call("companion.toggle", tab, id);
    },

    registerHostEditorSection(section) {
      const componentKey = `hostSection:${section.id}`;
      const { component, icon: sectionIcon, ...rest } = section;
      return add(
        "hostEditorSection",
        {
          ...rest,
          icon: icon(sectionIcon),
          component: scoped(component, componentKey),
        },
        { componentKeys: [componentKey] },
      );
    },

    registerHostAction(action) {
      const { icon: actionIcon, ...rest } = action;
      return add("hostAction", { ...rest, icon: icon(actionIcon) });
    },

    registerHostProtocol(protocol) {
      return add("hostProtocol", { ...protocol });
    },

    registerHostBadge(badge) {
      if (badge.component) {
        throw new Error(
          `${pluginId}: a framed plugin's host badge can only be a dot (useDot)`,
        );
      }
      const hooks: HookSpec[] = badge.useDot
        ? [{ key: `badge:${badge.id}:dot`, use: badge.useDot, perHost: true }]
        : [];
      return add(
        "hostBadge",
        {
          id: badge.id,
          when: badge.when,
          order: badge.order,
          dotKey: badge.useDot ? `badge:${badge.id}:dot` : undefined,
        },
        { hooks },
      );
    },

    registerHostStatusIndicator() {
      throw new Error(
        `${pluginId}: host status indicators are drawn in every host row and can't run in a frame`,
      );
    },

    registerHostEditorToolbarItem() {
      throw new Error(
        `${pluginId}: host editor toolbar items can't run in a frame yet`,
      );
    },

    registerHostSection(section) {
      const componentKey = `hostPage:${section.id}`;
      const { component, ...rest } = section;
      return add(
        "hostSection",
        { ...rest, component: scoped(component, componentKey) },
        { componentKeys: [componentKey] },
      );
    },

    registerHostContextMenuItem(item) {
      const { icon: itemIcon, ...rest } = item;
      return add("hostContextMenuItem", { ...rest, icon: icon(itemIcon) });
    },

    registerPaletteEntry(entry) {
      const { icon: entryIcon, ...rest } = entry as typeof entry & {
        icon?: unknown;
      };
      return add("paletteEntry", { ...rest, icon: icon(entryIcon) });
    },

    registerPaletteGroup(group) {
      return add("paletteGroup", { ...group });
    },

    registerKeybindingAction(action) {
      const keys: string[] = [];
      const { editor, summary, ...rest } = action;
      let editorRef: WireComponent | undefined;
      let summaryRef: WireComponent | undefined;
      if (editor) {
        keys.push(`keybinding:${action.id}:editor`);
        editorRef = scoped(editor, `keybinding:${action.id}:editor`);
      }
      if (summary) {
        keys.push(`keybinding:${action.id}:summary`);
        summaryRef = scoped(summary, `keybinding:${action.id}:summary`);
      }
      return add(
        "keybindingAction",
        { ...rest, editor: editorRef, summary: summaryRef },
        { componentKeys: keys },
      );
    },

    registerKeybindingDefault(binding) {
      return add("keybindingDefault", { ...binding });
    },

    registerDashboardCard(card) {
      requireDeclared(["dashboardCards"], card.id, "dashboard card");
      const componentKey = `card:${card.id}`;
      const { component, ...rest } = card;
      return add(
        "dashboardCard",
        { ...rest, component: scoped(component, componentKey) },
        { componentKeys: [componentKey] },
      );
    },

    registerExtension(pointId, extension) {
      const keys: string[] = [];
      const {
        components: parts,
        icon: extensionIcon,
        ...rest
      } = extension as typeof extension & { icon?: unknown };
      const wired: Record<string, WireComponent> = {};
      for (const [name, component] of Object.entries(parts ?? {})) {
        const componentKey = `ext:${pointId}:${extension.id}:${name}`;
        keys.push(componentKey);
        wired[name] = scoped(component, componentKey);
      }
      // Kept in this frame too, so the plugin can read its own extensions
      // with their components (Homepage's own widgets).
      const dropOwn = track(
        registerOwnExtension(pointId, { ...extension, pluginId }),
      );
      const drop = add(
        "extension",
        {
          ...rest,
          pointId,
          icon: icon(extensionIcon),
          components: parts ? wired : undefined,
        },
        { componentKeys: keys },
      );
      return () => {
        dropOwn();
        drop();
      };
    },

    listHosts: () =>
      host.call("hosts.list") as Promise<
        Awaited<ReturnType<TermixApp["listHosts"]>>
      >,

    getHost(hostId) {
      const found = getFrameState().hosts.find(
        (entry) => entry.id === String(hostId),
      );
      return found as unknown as ReturnType<TermixApp["getHost"]>;
    },

    registerSettingsComponent(componentId, component) {
      const componentKey = `settings:${componentId}`;
      return add(
        "settingsComponent",
        { componentId, component: scoped(component, componentKey) },
        { componentKeys: [componentKey] },
      );
    },

    registerAction(id, handler, options = {}) {
      return add("action", {
        id,
        handler,
        permission: options.permission,
      });
    },

    declareActionSlot(slot) {
      return add("actionSlot", { ...slot });
    },

    registerSlotContribution(slotId, contribution) {
      const keys: string[] = [];
      const { component, icon: slotIcon, ...rest } = contribution;
      let componentRef: WireComponent | undefined;
      if (component) {
        const componentKey = `slot:${slotId}:${contribution.actionId}`;
        keys.push(componentKey);
        componentRef = scoped(component, componentKey);
      }
      return add(
        "slotContribution",
        { ...rest, slotId, icon: icon(slotIcon), component: componentRef },
        { componentKeys: keys },
      );
    },

    registerOnboardingStep(step) {
      const componentKey = `onboarding:${step.id}`;
      const { component, icon: stepIcon, ...rest } = step;
      return add(
        "onboardingStep",
        {
          ...rest,
          icon: icon(stepIcon),
          component: scoped(component, componentKey),
        },
        { componentKeys: [componentKey] },
      );
    },

    invokeAction: (id, ...args) => host.call("invokeAction", id, ...args),

    registerComponent(id, component) {
      const componentKey = `component:${id}`;
      return add(
        "component",
        { id, component: scoped(component, componentKey) },
        { componentKeys: [componentKey] },
      );
    },

    registerSshAuthEditor(editor) {
      const keys: string[] = [];
      const { component, ...rest } = editor;
      let componentRef: WireComponent | undefined;
      if (component) {
        const componentKey = `sshAuthEditor:${editor.authType}`;
        keys.push(componentKey);
        componentRef = scoped(component, componentKey);
      }
      return add(
        "sshAuthEditor",
        { ...rest, component: componentRef },
        { componentKeys: keys },
      );
    },

    registerLoginMethod() {
      throw new Error(`${pluginId}: login methods: ${SHELL_PARTS}`);
    },

    registerSecondFactorUI() {
      throw new Error(`${pluginId}: second factors: ${SHELL_PARTS}`);
    },

    registerLayout() {
      throw new Error(`${pluginId}: layouts: ${SHELL_PARTS}`);
    },

    t: ((value: string, options?: Record<string, unknown> | string) =>
      i18n.t(
        pluginKey(pluginId, value),
        options as Record<string, unknown>,
      )) as TermixApp["t"],

    hasPermission: async (permission) => {
      try {
        return await hasPermission(
          resolvePluginPermission(pluginId, permission),
        );
      } catch {
        return false;
      }
    },

    api: host.api,
    apiFor: () => host.api,
    fetch: host.fetch,
    wsUrl: host.wsUrl,

    tabs: {
      openTab: (target, type, options) =>
        void host.call(
          "tabs.openTab",
          target ? String(target.id) : null,
          type,
          options,
        ),
      openSingletonTab: (type, options) =>
        void host.call("tabs.openSingletonTab", type, options),
      connectHost: (target, type) =>
        void host.call("tabs.connectHost", String(target.id), type),
      closeTab: (tabId) => void host.call("tabs.closeTab", tabId),
      openRailView: (id) => void host.call("tabs.openRailView", id),
      getLayout: () =>
        getFrameState().layout as ReturnType<TermixApp["tabs"]["getLayout"]>,
      applyLayout: (layout, options) =>
        host.call("tabs.applyLayout", layout, options) as Promise<{
          skipped: string[];
        }>,
      onChange: (listener) => {
        let last = getFrameState().tabs;
        return track(
          subscribeFrameState(() => {
            const next = getFrameState().tabs;
            if (next === last) return;
            last = next;
            listener();
          }),
        );
      },
      onReady: (listener) => {
        if (getFrameState().tabsReady) {
          queueMicrotask(listener);
          return () => {};
        }
        let unsubscribe: () => void = () => {};
        unsubscribe = subscribeFrameState(() => {
          if (!getFrameState().tabsReady) return;
          unsubscribe();
          listener();
        });
        return track(() => unsubscribe());
      },
    },

    confirm: (options) => host.call("confirm", options) as Promise<boolean>,

    docs: (() => {
      const url = pluginDocsUrl(manifest?.docs);
      const page = (name?: string, anchor?: string) =>
        url ? pluginDocsPage(url, name, anchor) : null;
      return {
        url,
        page,
        open(name?: string, anchor?: string) {
          const target = page(name, anchor);
          if (target) void host.call("openUrl", target);
        },
      };
    })(),

    desktop: {
      get available() {
        return getFrameState().desktop.available;
      },
      remoteServerUrl: async () => getFrameState().desktop.remoteServerUrl,
      onRemoteServerChange: (listener) => {
        let last = getFrameState().desktop.remoteServerUrl;
        return track(
          subscribeFrameState(() => {
            const next = getFrameState().desktop.remoteServerUrl;
            if (next === last) return;
            last = next;
            listener();
          }),
        );
      },
    },

    onSettingsChanged: (listener) => {
      const handler = (event: Event) => {
        const detail = (event as CustomEvent).detail as {
          pluginId?: string;
          scope: "admin" | "user" | "host";
          hostId?: number;
        };
        if (detail?.pluginId !== pluginId) return;
        listener({ scope: detail.scope, hostId: detail.hostId });
      };
      window.addEventListener("termix:plugin-settings-changed", handler);
      return track(() =>
        window.removeEventListener("termix:plugin-settings-changed", handler),
      );
    },

    onDispose(dispose) {
      if (disposed) {
        dispose();
        return;
      }
      bag.push(dispose);
    },
  };

  (app as unknown as { frame: unknown }).frame = {
    role: host.role,
    available: true,
  };

  return {
    app,
    dispose() {
      disposed = true;
      while (bag.length > 0) {
        const disposer = bag.pop()!;
        try {
          disposer();
        } catch (error) {
          console.error(`[plugins] ${pluginId}: a disposer threw`, error);
        }
      }
    },
  };
}
