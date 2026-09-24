import type { ComponentType } from "react";
import type {
  Disposer,
  PluginManifest,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import type { PluginContributions } from "@/api/plugins-api";
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
import { registerPaletteEntry } from "@/shell/palette-registry";
import { registerHostProtocol } from "@/sidebar/host-protocols";
import {
  registerDashboardCard,
  type DashboardCardRenderProps,
} from "@/dashboard/dashboard-cards-registry";
import { registerWidget } from "@/features/homepage/widgets/WidgetRegistry";
import { registerSettingsComponent } from "@/settings/settings-components";
import {
  declareActionSlot,
  invokeAction,
  registerAction,
  registerSlotContribution,
} from "@/shell/action-registry";
import { pluginApiFor, pluginWsUrl } from "@/lib/plugin-transport";
import { registerPluginComponent } from "./component-registry";
import type { WidgetTypeDefinition } from "@/types/homepage-types";
import type { LucideIcon } from "lucide-react";
import {
  registerLoginMethod,
  registerSecondFactor,
  registerSshAuthEditor,
} from "./auth-registry";
import { pluginHostBridge, resolvePluginPermission } from "./bridge";
import { shell, tabsApi } from "./shell-bridge";
import { withPluginScope } from "./scope";
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
          icon: item.icon as unknown as LucideIcon,
          labelKey: key(item.titleKey),
          kind: item.kind === "tab" ? "tab" : undefined,
          hideable: item.hideable,
          promotable: item.promotable,
          rightDockable: item.rightDockable,
          mobilePrimary: item.mobilePrimary,
          electronOnly: item.electronOnly,
          separatorAfter: item.separatorAfter ?? true,
          hidden: item.hidden,
          after: item.after,
          order: item.order,
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
          icon: options.icon,
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
          icon: section.icon,
          order: section.order,
          visible: section.visible,
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
          when: action.when as never,
          run: action.run as never,
          label: action.label as never,
          items: action.items as never,
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
        }),
      );
    },

    registerHostBadge(badge) {
      return track(
        registerHostBadge({
          id: badge.id,
          pluginId,
          when: badge.when as never,
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
          when: item.when as never,
          run: item.run as never,
        }),
      );
    },

    registerPaletteEntry(entry) {
      return track(
        registerPaletteEntry({
          ...entry,
          titleKey: key(entry.titleKey),
          pluginId,
          when: entry.when as never,
          run: entry.run as never,
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
          component: scoped(
            card.component as unknown as ComponentType<DashboardCardRenderProps>,
          ),
        }),
      );
    },

    registerHomepageWidget(widget) {
      return track(
        registerWidget({
          ...widget,
          component: scoped(widget.component),
          editFormComponent: widget.editFormComponent
            ? scoped(widget.editFormComponent)
            : undefined,
        } as unknown as WidgetTypeDefinition),
      );
    },

    registerSettingsComponent(componentId, component) {
      return track(
        registerSettingsComponent(pluginId, componentId, scoped(component)),
      );
    },

    registerAction(id, handler, options = {}) {
      return track(
        registerAction(id, handler, {
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
    wsUrl: (path, options) =>
      pluginWsUrl(pluginId, path, options as never) as ReturnType<
        TermixApp["wsUrl"]
      >,

    tabs: {
      ...tabsApi,
      openTab: shell.openTab as TermixApp["tabs"]["openTab"],
      openSingletonTab: shell.openSingletonTab,
      closeTab: shell.closeTab,
      onChange: (listener) => track(tabsApi.onChange(listener)),
      onReady: (listener) => track(tabsApi.onReady(listener)),
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
