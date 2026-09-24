/**
 * The Termix side of @termix/plugin-sdk/testing's renderWithApp.
 *
 * Activates a plugin against the real registries, the real app object and
 * the real SDK bridge, then renders whatever it registered with Testing
 * Library. Shell calls are recorded rather than performed, since there is no
 * AppShell in a unit test.
 */

import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import type { PluginManifest } from "@termix/plugin-sdk/frontend";
import type {
  FrontendPluginModule,
  RenderWithAppOptions,
  RenderedPluginApp,
  ShellCall,
} from "@termix/plugin-sdk/testing";
import i18n from "@/i18n/i18n";
import type { PluginSummary } from "@/api/plugins-api";
import { ThemeProvider } from "@/components/theme-provider";
import { setPermissionsForTesting } from "@/hooks/use-permissions";
import {
  getTabType,
  listTabTypes,
  type TabShellCallbacks,
} from "@/shell/tab-registry";
import { getPanel, listPanels } from "@/shell/panel-registry";
import { listRegisteredRailItems } from "@/sidebar/rail-items";
import { listHostActions } from "@/sidebar/host-contributions";
import { listHostProtocols } from "@/sidebar/host-protocols";
import {
  getHostEditorSection,
  hostEditorSectionList,
} from "@/sidebar/HostManagerTabs";
import {
  getRegisteredDashboardCard,
  registeredDashboardCardList,
} from "@/dashboard/dashboard-cards-registry";
import {
  getSettingsComponent,
  listSettingsComponents,
} from "@/settings/settings-components";
import { getSlotContributions, listActions } from "@/shell/action-registry";
import {
  getLoginMethodUI,
  getSecondFactorUI,
  listLoginMethodUIs,
  listSecondFactorUIs,
} from "./auth-registry";
import { ActionSlot, ComponentSlot } from "@/shell/ActionSlot";
import type { Host, Tab } from "@/types/ui-types";
import { createPluginApp } from "./app";
import { installPluginHostBridge, setPluginApiForTesting } from "./bridge";
import { setPluginSummaries, setFrontendState } from "./plugin-store";
import {
  notifyShellReady,
  resetShellBridge,
  setShellCallbacks,
  setShellHosts,
  setShellLayoutProvider,
} from "./shell-bridge";
import { PluginViewPlaceholder } from "./PluginViewPlaceholder";
import { resolveLayoutTabTarget } from "@/shell/shell-layout";
import type { WorkspaceTabSnapshot } from "@/types/ui-types";

function recordingShell(calls: ShellCall[]): TabShellCallbacks {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  return {
    openTab: record("openTab"),
    openSingletonTab: record("openSingletonTab"),
    closeTab: record("closeTab"),
    renameTab: record("renameTab"),
    openRailView: record("openRailView"),
    closeRailView: record("closeRailView"),
    saveQuickConnect: async (...args) => {
      calls.push({ method: "saveQuickConnect", args });
    },
  };
}

function wrap(element: ReactElement): HTMLElement {
  return render(
    <ThemeProvider defaultTheme="dark" storageKey="termix-test-theme">
      {element}
    </ThemeProvider>,
  ).container;
}

function missing(kind: string, id: string | number): never {
  throw new Error(`renderWithApp: nothing registered ${kind} "${id}"`);
}

export async function renderPlugin(
  plugin: FrontendPluginModule,
  options: RenderWithAppOptions = {},
): Promise<RenderedPluginApp> {
  const pluginId = options.pluginId ?? options.manifest?.id ?? "test-plugin";
  const manifest = {
    id: pluginId,
    name: pluginId,
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities: [],
    ...options.manifest,
  } as PluginManifest;

  installPluginHostBridge();
  resetShellBridge();
  setPermissionsForTesting(options.permissions ?? [], options.isAdmin);
  const hosts = (options.hosts ?? []) as unknown as Host[];
  setShellHosts(hosts);
  const shellCalls: ShellCall[] = [];
  const shell = recordingShell(shellCalls);
  setShellCallbacks(shell);

  // Stands in for AppShell's layout: applying one runs the shell's own
  // restore rules and records which tabs it would open.
  let layout = options.layout ?? null;
  const opened: Array<{ type: string; hostId?: number; label: string }> = [];
  setShellLayoutProvider({
    getLayout: () => layout,
    applyLayout: async (next, applyOptions) => {
      shellCalls.push({ method: "applyLayout", args: [next, applyOptions] });
      layout = next;
      opened.length = 0;
      const skipped: string[] = [];
      const tabs = (next.tabs ?? []) as WorkspaceTabSnapshot[];
      for (const snapshot of tabs) {
        const target = resolveLayoutTabTarget(snapshot, hosts);
        if (target.kind === "skip") {
          skipped.push(snapshot.hostNameSnapshot || snapshot.label);
          continue;
        }
        opened.push({
          type: snapshot.type,
          hostId:
            "host" in target && target.host
              ? Number(target.host.id)
              : undefined,
          label: snapshot.customLabel ?? snapshot.label,
        });
      }
      return { skipped };
    },
  });

  const summary: PluginSummary = {
    id: pluginId,
    name: manifest.name,
    version: manifest.version,
    enabled: true,
    state: "active",
    contributes: (manifest.contributes ?? null) as PluginSummary["contributes"],
    frontend: true,
  };
  setPluginSummaries([summary]);

  if (options.locales) {
    i18n.addResourceBundle(
      "en",
      pluginId,
      options.locales as Record<string, unknown>,
      true,
      true,
    );
  }

  setPluginApiForTesting(
    pluginId,
    (options.api as Parameters<typeof setPluginApiForTesting>[1]) ?? null,
  );
  const handle = createPluginApp(pluginId, manifest, summary.contributes, {
    guest: options.guest,
  });
  await plugin.activate(handle.app);
  setFrontendState(pluginId, "active");
  if (options.ready) notifyShellReady();

  const mine = <T extends { pluginId?: string }>(items: T[]) =>
    items.filter((item) => item.pluginId === pluginId);

  const tabRecord = (type: string, host?: Host): Tab => ({
    id: `${type}-test`,
    instanceId: `${type}-test`,
    type,
    label: type,
    host,
    openedAt: 0,
  });

  return {
    app: handle.app,
    shellCalls,
    registered: {
      railItems: () =>
        mine(listRegisteredRailItems()).map((item) => ({
          id: item.id,
          hidden: item.hidden,
          permission: item.permission,
        })),
      tabs: () => mine(listTabTypes()).map((def) => def.id),
      panels: () => mine(listPanels()).map((panel) => panel.id),
      hostActions: () =>
        mine(listHostActions()).map((action) => ({
          id: action.id,
          tabType: action.tabType,
        })),
      hostProtocols: () =>
        mine(listHostProtocols()).map((protocol) => protocol.id),
      hostEditorSections: () =>
        mine(hostEditorSectionList()).map((section) => section.id),
      dashboardCards: () =>
        mine(registeredDashboardCardList()).map((card) => card.id),
      settingsComponents: () =>
        listSettingsComponents()
          .filter((key) => key.startsWith(`${pluginId}:`))
          .map((key) => key.slice(pluginId.length + 1)),
      slot: (slotId) =>
        mine(getSlotContributions(slotId)).map(
          (contribution) => contribution.actionId,
        ),
      actions: () => mine(listActions()).map((action) => action.id),
      loginMethods: () => mine(listLoginMethodUIs()).map((method) => method.id),
      secondFactors: () =>
        mine(listSecondFactorUIs()).map((factor) => factor.id),
    },

    renderTab(type, props = {}) {
      const def = getTabType(type) ?? missing("a tab", type);
      const Component = def.component;
      const host = props.host as Host | undefined;
      return wrap(
        <Component
          tab={tabRecord(type, host)}
          host={host}
          label={type}
          isVisible
          isFocusedPane
          handleRef={null}
          shell={shell}
          {...props}
        />,
      );
    },

    openedTabs: () => opened.map((tab) => ({ ...tab })),

    renderOpenedTab(index) {
      const tab = opened[index] ?? missing("an opened tab at index", index);
      const def = getTabType(tab.type);
      if (!def) {
        // What tabUtils renders for a tab no running plugin registered.
        return wrap(<PluginViewPlaceholder kind="tab" viewId={tab.type} />);
      }
      const Component = def.component;
      return wrap(
        <Component
          tab={tabRecord(tab.type)}
          label={tab.label}
          isVisible
          isFocusedPane
          handleRef={null}
          shell={shell}
        />,
      );
    },

    renderPanel(id, props = {}) {
      const panel = getPanel(id) ?? missing("a panel", id);
      const Component = panel.component;
      return wrap(
        <Component
          active
          shell={shell}
          setEditing={() => {}}
          placement="left"
          {...props}
        />,
      );
    },

    renderDashboardCard(id) {
      const card = getRegisteredDashboardCard(id) ?? missing("a card", id);
      const Component = card.component;
      return wrap(<Component isVisible shell={shell} />);
    },

    renderHostEditorSection(id, props = {}) {
      const section =
        getHostEditorSection(id) ?? missing("a host editor section", id);
      const Component = section.component;
      return wrap(
        <Component
          form={{}}
          setField={() => {}}
          updateForm={() => {}}
          protocols={{}}
          {...props}
        />,
      );
    },

    renderSettingsComponent(componentId, props = {}) {
      const Component =
        getSettingsComponent(pluginId, componentId) ??
        missing("a settings component", componentId);
      return wrap(
        <Component
          pluginId={pluginId}
          values={{}}
          setValue={() => {}}
          running
          {...props}
        />,
      );
    },

    renderLoginMethod(id, props = {}) {
      const method = getLoginMethodUI(id) ?? missing("a login method", id);
      const Component = method.component;
      return wrap(
        <Component
          methodId={id}
          instances={[]}
          rememberMe={false}
          disabled={false}
          submit={async () => {}}
          startRedirect={async () => {}}
          complete={async () => {}}
          {...props}
        />,
      );
    },

    renderSecondFactor(id, props = {}) {
      const factor = getSecondFactorUI(id) ?? missing("a second factor", id);
      const Component = factor.component;
      return wrap(
        <Component
          factorId={id}
          rememberMe={false}
          disabled={false}
          verify={async () => {}}
          challenge={async () => null}
          cancel={() => {}}
          {...props}
        />,
      );
    },

    renderEnrollment(id) {
      const entry = getSecondFactorUI(id) ?? getLoginMethodUI(id);
      const Component =
        entry?.enrollment ?? missing("an enrolment section", id);
      return wrap(<Component />);
    },

    renderSlot(slotId, props = {}) {
      return wrap(
        <>
          <ActionSlot slotId={slotId} />
          <ComponentSlot slotId={slotId} props={props} />
        </>,
      );
    },

    async deactivate() {
      try {
        await plugin.deactivate?.();
      } finally {
        handle.dispose();
        setFrontendState(pluginId, "inactive");
        setPluginApiForTesting(pluginId, null);
      }
    },
  };
}
