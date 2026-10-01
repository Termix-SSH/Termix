import type { ComponentType } from "react";
import type {
  Disposer,
  PluginManifest,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import {
  PLUGIN_SETTINGS_CHANGED_EVENT,
  type PluginContributions,
} from "@/api/plugins-api";
import { registerRailItem } from "@/sidebar/rail-items";
import { registerTabType, type TabRenderProps } from "@/shell/tab-registry";
import { registerPanel, type PanelRenderProps } from "@/shell/panel-registry";
import {
  registerHostEditorSection,
  type HostEditorSectionRenderProps,
} from "@/sidebar/HostManagerTabs";
import {
  registerHostAction,
  registerHostBadge,
  registerHostContextMenuItem,
} from "@/sidebar/host-contributions";
import {
  registerPaletteEntry,
  registerPaletteGroup,
  type PaletteItemDef,
} from "@/shell/palette-registry";
import {
  registerKeybindingAction,
  registerKeybindingDefault,
  type KeybindingEditorProps,
} from "@/shell/keybinding-registry";
import { registerHostProtocol } from "@/sidebar/host-protocols";
import {
  registerDashboardCard,
  type DashboardCardRenderProps,
} from "@/dashboard/dashboard-cards-registry";
import { registerExtension } from "./extension-registry";
import { registerSettingsComponent } from "@/settings/settings-components";
import {
  declareActionSlot,
  invokeAction,
  registerAction,
  registerSlotContribution,
} from "@/shell/action-registry";
import { pluginApiFor, pluginFetch, pluginWsUrl } from "@/lib/plugin-transport";
import { registerPluginComponent } from "./component-registry";
import type { LucideIcon } from "lucide-react";
import {
  registerLoginMethod,
  registerSecondFactor,
  registerSshAuthEditor,
} from "./auth-registry";
import {
  pluginHostBridge,
  resolvePluginPermission,
  toPluginHostRecord,
} from "./bridge";
import { shell, shellHost, tabsApi } from "./shell-bridge";
import { onRemoteServerChange, remoteServerUrl } from "./desktop";
import { isElectron } from "@/lib/electron";
import { withPluginScope, withIconBoundary, guardCallback } from "./scope";
import {
  scopeHostArgs,
  scopeHostCallback,
  scopeHostFields,
} from "./host-scope";
import { manifestDeclares, type ViewKind } from "./view-ownership";
import { pluginKey } from "@/lib/plugin-i18n";
import { hasPermission } from "@/hooks/use-permissions";
import i18n from "@/i18n/i18n";

export interface PluginAppHandle {
  app: TermixApp;
  /** Runs every disposer, newest first, isolating failures. */
  dispose: () => void;
}

/**
 * Builds the object a plugin's `activate(app)` receives.
 *
 * Every registration goes into one bag, so disabling the plugin removes all
 * of it whatever the plugin's own `deactivate` does. Components are wrapped
 * in the plugin's scope as they are registered, which is what gives the SDK
 * hooks their plugin id and keeps a crash inside the plugin's own box.
 */
export function createPluginApp(
  pluginId: string,
  manifest: PluginManifest,
  contributes: PluginContributions | null,
  options: { guest?: boolean } = {},
): PluginAppHandle {
  const bag: Disposer[] = [];
  let disposed = false;

  const track = (disposer: Disposer): Disposer => {
    // An activate that outlived its timeout, or ran on after a disable, still
    // registers things. Nothing will dispose them later, so undo them now.
    if (disposed) {
      try {
        disposer();
      } catch {
        // A failing disposer must not throw into the plugin's activate.
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

  const scoped = <P extends object>(component: ComponentType<P>) =>
    withPluginScope(pluginId, component);

  const key = (value: string) => pluginKey(pluginId, value);

  // Every host a plugin callback receives carries only this plugin's settings.
  const hostCallback = <F extends (...args: never[]) => unknown>(
    fn: F | undefined,
  ): F | undefined => scopeHostCallback(fn, pluginId);

  const requireDeclared = (kind: ViewKind, id: string, what: string) => {
    if (!manifestDeclares(contributes, kind, id)) {
      const field =
        kind === "tab"
          ? "contributes.tabs"
          : kind === "panel"
            ? "contributes.panels or contributes.tabs"
            : "contributes.dashboardCards";
      throw new Error(
        `${pluginId}: ${what} "${id}" is not declared in manifest ${field}`,
      );
    }
  };

  const app: TermixApp = {
    pluginId,
    manifest,
    guest: !!options.guest,

    registerRailItem(item) {
      requireDeclared("panel", item.id, "rail item");
      return track(
        registerRailItem({
          id: item.id,
          icon: withIconBoundary(
            pluginId,
            item.icon as unknown as LucideIcon,
          ) as unknown as LucideIcon,
          labelKey: key(item.titleKey),
          kind: item.kind === "tab" ? "tab" : undefined,
          hideable: item.hideable,
          simplePreset: item.simplePreset,
          promotable: item.promotable,
          rightDockable: item.rightDockable,
          mobilePrimary: item.mobilePrimary,
          electronOnly: item.electronOnly,
          separatorAfter: item.separatorAfter ?? true,
          hidden: item.hidden,
          after: item.after,
          order: item.order,
          placement: item.placement,
          useBadge: item.useBadge,
          pluginId,
          permission: item.permission
            ? resolvePluginPermission(pluginId, item.permission)
            : undefined,
        }),
      );
    },

    registerPanel(id, component, options) {
      requireDeclared("panel", id, "panel");
      return track(
        registerPanel({
          id,
          pluginId,
          component: scoped(
            component as unknown as ComponentType<PanelRenderProps>,
          ),
          keepMounted: options?.keepMounted,
        }),
      );
    },

    registerTab(type, component, options = {}) {
      requireDeclared("tab", type, "tab type");
      return track(
        registerTabType({
          id: type,
          pluginId,
          component: scoped(
            component as unknown as ComponentType<TabRenderProps>,
          ),
          icon: withIconBoundary(pluginId, options.icon as never) as never,
          titleKey: options.titleKey ? key(options.titleKey) : undefined,
          requiresHost: options.requiresHost,
          noHostMessageKey: options.noHostMessageKey
            ? key(options.noHostMessageKey)
            : undefined,
          persistent: options.persistent,
          singleton: options.singleton,
          session: options.session,
          hostless: options.hostless,
          restore: options.restore as never,
          activityTypes: options.activityTypes,
          standalone: options.standalone
            ? scoped(options.standalone)
            : undefined,
          standaloneViews: options.standaloneViews,
          panelFrame: options.panelFrame,
          inLayouts: options.inLayouts,
          commandTarget: options.commandTarget,
          ownBackground: options.ownBackground,
          multiInstance: options.multiInstance,
          preload: options.preload,
        }),
      );
    },

    registerHostEditorSection(section) {
      return track(
        registerHostEditorSection({
          id: section.id,
          pluginId,
          group: section.group,
          labelKey: key(section.titleKey),
          icon: withIconBoundary(pluginId, section.icon as never) as never,
          order: section.order,
          visible: section.visible,
          defaults: section.defaults,
          component: scoped(
            section.component as unknown as ComponentType<HostEditorSectionRenderProps>,
          ),
        }),
      );
    },

    registerHostAction(action) {
      return track(
        registerHostAction({
          ...action,
          titleKey: key(action.titleKey),
          pluginId,
          icon: withIconBoundary(pluginId, action.icon as never) as never,
          when: hostCallback(action.when) as never,
          run: hostCallback(action.run) as never,
          // Called while the host list renders, so a throw must not escape.
          label: guardCallback(
            pluginId,
            hostCallback(
              action.label as ((...args: unknown[]) => unknown) | undefined,
            ),
            undefined,
          ) as never,
          items: guardCallback(
            pluginId,
            action.items
              ? (...args: unknown[]) =>
                  (
                    action.items as (
                      ...a: unknown[]
                    ) => { run: (...a: never[]) => unknown }[]
                  )(...scopeHostArgs(args, pluginId))?.map((item) => ({
                    ...item,
                    run: hostCallback(item.run),
                  }))
              : undefined,
            undefined,
          ) as never,
        }),
      );
    },

    registerHostProtocol(protocol) {
      return track(
        registerHostProtocol({
          ...protocol,
          pluginId,
          titleKey: key(protocol.titleKey),
          descriptionKey: protocol.descriptionKey
            ? key(protocol.descriptionKey)
            : undefined,
          connectionOriginNoteKey: protocol.connectionOriginNoteKey
            ? key(protocol.connectionOriginNoteKey)
            : undefined,
        }),
      );
    },

    registerHostBadge(badge) {
      return track(
        registerHostBadge({
          id: badge.id,
          pluginId,
          when: hostCallback(badge.when) as never,
          component: scoped(badge.component) as never,
        }),
      );
    },

    registerHostContextMenuItem(item) {
      return track(
        registerHostContextMenuItem({
          ...item,
          titleKey: key(item.titleKey),
          pluginId,
          when: hostCallback(item.when) as never,
          run: hostCallback(item.run) as never,
        }),
      );
    },

    registerPaletteEntry(entry) {
      return track(
        registerPaletteEntry({
          ...entry,
          titleKey: key(entry.titleKey),
          pluginId,
          when: hostCallback(entry.when) as never,
          run: hostCallback(entry.run) as never,
        }),
      );
    },

    registerPaletteGroup(group) {
      return track(
        registerPaletteGroup({
          id: group.id,
          pluginId,
          titleKey: key(group.titleKey),
          order: group.order,
          showWhenEmpty: group.showWhenEmpty,
          load: group.load as unknown as () => Promise<PaletteItemDef[]>,
        }),
      );
    },

    registerKeybindingAction(action) {
      const declared = (manifest.contributes?.keybindingActions ?? []).some(
        (entry) => entry.id === action.id,
      );
      if (!declared) {
        throw new Error(
          `${pluginId}: keybinding action "${action.id}" is not declared in manifest contributes.keybindingActions`,
        );
      }
      const validate = action.validate;
      return track(
        registerKeybindingAction({
          id: action.id,
          pluginId,
          labelKey: key(action.titleKey),
          scope: action.scope ?? "session",
          editor: action.editor
            ? (scoped(action.editor) as ComponentType<KeybindingEditorProps>)
            : undefined,
          summary: action.summary
            ? (scoped(action.summary) as ComponentType<KeybindingEditorProps>)
            : undefined,
          validate: validate
            ? (value) => {
                const problem = validate(value);
                return problem ? key(problem) : null;
              }
            : undefined,
          run: action.run,
        }),
      );
    },

    registerKeybindingDefault(binding) {
      return track(
        registerKeybindingDefault({
          id: binding.id,
          pluginId,
          combo: binding.combo,
          descriptionKey: key(binding.descriptionKey),
        }),
      );
    },

    registerDashboardCard(card) {
      requireDeclared("card", card.id, "dashboard card");
      return track(
        registerDashboardCard({
          id: card.id,
          pluginId,
          titleKey: key(card.titleKey),
          defaultHeight: card.defaultHeight,
          defaultPanel: card.defaultPanel,
          component: scoped(
            card.component as unknown as ComponentType<DashboardCardRenderProps>,
          ),
        }),
      );
    },

    registerExtension(pointId, extension) {
      const components = extension.components
        ? Object.fromEntries(
            Object.entries(extension.components).map(([name, component]) => [
              name,
              scoped(component),
            ]),
          )
        : undefined;
      return track(
        registerExtension(pointId, { ...extension, components, pluginId }),
      );
    },

    listHosts: () => pluginHostBridge.core.listHosts(pluginId),

    getHost(hostId) {
      const host = shellHost(hostId);
      return host ? toPluginHostRecord(host, pluginId) : undefined;
    },

    registerSettingsComponent(componentId, component) {
      return track(
        registerSettingsComponent(pluginId, componentId, scoped(component)),
      );
    },

    registerAction(id, handler, options = {}) {
      return track(
        registerAction(id, hostCallback(handler), {
          permission: options.permission
            ? resolvePluginPermission(pluginId, options.permission)
            : undefined,
          pluginId,
        }),
      );
    },

    declareActionSlot(slot) {
      return track(declareActionSlot(slot));
    },

    registerSlotContribution(slotId, contribution) {
      return track(
        registerSlotContribution(slotId, {
          ...contribution,
          titleKey: key(contribution.titleKey),
          descriptionKey: contribution.descriptionKey
            ? key(contribution.descriptionKey)
            : undefined,
          component: contribution.component
            ? scoped(contribution.component)
            : undefined,
          when: contribution.when
            ? (context: Record<string, unknown>) =>
                contribution.when!(scopeHostFields(context, pluginId))
            : undefined,
          pluginId,
        }),
      );
    },

    invokeAction: (id, ...args) => invokeAction(id, ...args),

    registerComponent(id, component) {
      return track(registerPluginComponent(id, scoped(component)));
    },

    registerSshAuthEditor(editor) {
      return track(
        registerSshAuthEditor({
          id: editor.authType,
          pluginId,
          titleKey: key(editor.titleKey),
          hintKey: editor.hintKey ? key(editor.hintKey) : undefined,
          component: editor.component
            ? (scoped(editor.component) as never)
            : undefined,
        }),
      );
    },

    registerLoginMethod(method) {
      return track(
        registerLoginMethod({
          ...method,
          titleKey: key(method.titleKey),
          pluginId,
          component: scoped(method.component) as never,
          enrollment: method.enrollment
            ? (scoped(method.enrollment) as never)
            : undefined,
        }),
      );
    },

    registerSecondFactorUI(factor) {
      return track(
        registerSecondFactor({
          ...factor,
          titleKey: key(factor.titleKey),
          pluginId,
          component: scoped(factor.component) as never,
          enrollment: factor.enrollment
            ? (scoped(factor.enrollment) as never)
            : undefined,
        }),
      );
    },

    t: ((key: string, options?: Record<string, unknown> | string) =>
      i18n.t(
        pluginKey(pluginId, key),
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
    api: pluginHostBridge.getApi(pluginId),
    apiFor: (origin) =>
      pluginApiFor(
        pluginId,
        origin as never,
        pluginHostBridge.getApi(pluginId) as never,
      ) as unknown as TermixApp["api"],
    fetch: (path, init) => pluginFetch(pluginId, path, init),
    wsUrl: (path, options) =>
      pluginWsUrl(pluginId, path, options as never) as ReturnType<
        TermixApp["wsUrl"]
      >,

    tabs: {
      ...tabsApi,
      openTab: shell.openTab as TermixApp["tabs"]["openTab"],
      openSingletonTab: shell.openSingletonTab,
      connectHost: shell.connectHost as TermixApp["tabs"]["connectHost"],
      closeTab: shell.closeTab,
      onChange: (listener) => track(tabsApi.onChange(listener)),
      onReady: (listener) => track(tabsApi.onReady(listener)),
    },

    desktop: {
      available: isElectron(),
      remoteServerUrl,
      onRemoteServerChange: (listener) => track(onRemoteServerChange(listener)),
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
      window.addEventListener(PLUGIN_SETTINGS_CHANGED_EVENT, handler);
      return track(() =>
        window.removeEventListener(PLUGIN_SETTINGS_CHANGED_EVENT, handler),
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
