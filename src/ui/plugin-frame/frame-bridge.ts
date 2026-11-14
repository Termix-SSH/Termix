/**
 * The SDK bridge inside a frame. Most hooks work as they do in the page,
 * because their core reads go through the frame's network to the shell's
 * checked list. What lives in the shell itself (hosts, tabs, theme, toasts,
 * actions, other plugins' parts) comes from state the shell pushes, or a
 * call to it.
 */

import { useMemo } from "react";
import type {
  ActivityTargetInfo,
  CompanionInfo,
  HostActionContribution,
  HostStatusInfo,
  PluginHostBridge,
  PluginHostRecord,
  TabsApi,
} from "@termix-ssh/plugin-sdk/frontend";
import { pluginHostBridge } from "@/plugin-host/bridge";
import {
  getExtension as getOwnExtension,
  useExtensions as useOwnExtensions,
} from "@/plugin-host/extension-registry";
import { usePluginScope } from "@/plugin-host/scope";
import { decodeIcon } from "./frame-icons";
import { getFrameState, useFrameState } from "./frame-store";

export interface FrameBridgeHost {
  pluginId: string;
  call: (method: string, ...args: unknown[]) => Promise<unknown>;
  getApi: PluginHostBridge["getApi"];
  tabs: TabsApi;
}

export function createFrameBridge(host: FrameBridgeHost): PluginHostBridge {
  const call = host.call;
  const toast = (kind: string) => (message: string) =>
    void call("toast", kind, String(message)).catch(() => {});

  return {
    ...pluginHostBridge,

    useHost(hostId) {
      const hosts = useFrameState((state) => state.hosts);
      return useMemo(() => {
        if (hostId === undefined || hostId === null) return null;
        return (
          (hosts.find((entry) => entry.id === String(hostId)) as unknown as
            PluginHostRecord | undefined) ?? null
        );
      }, [hosts, hostId]);
    },

    useHosts() {
      const hosts = useFrameState((state) => state.hosts);
      const loaded = useFrameState((state) => state.hostsLoaded);
      return useMemo(
        () => ({ hosts: hosts as unknown as PluginHostRecord[], loaded }),
        [hosts, loaded],
      );
    },

    useTheme() {
      const mode = useFrameState((state) => state.theme.mode);
      return { theme: mode };
    },

    useShell: () => null,

    toast: {
      success: toast("success"),
      error: toast("error"),
      info: toast("info"),
      warning: toast("warning"),
    },

    getApi: host.getApi,
    getApiFor: (pluginId) => host.getApi(pluginId),

    useTabs: () => host.tabs,

    invokeAction: (id, ...args) => call("invokeAction", id, ...args),

    useSshAuthTypes() {
      const value = useFrameState((state) => state.sshAuthTypes);
      return value as unknown as ReturnType<
        PluginHostBridge["useSshAuthTypes"]
      >;
    },

    // Other plugins' components can't be drawn inside this frame. The
    // frame's own extensions can.
    useSlotContributions: () => [],
    usePluginComponent: () => undefined,
    useExtensions: (pointId) =>
      useOwnExtensions(pointId) as ReturnType<
        PluginHostBridge["useExtensions"]
      >,
    getExtension: (pointId, id) =>
      getOwnExtension(pointId, id) as ReturnType<
        PluginHostBridge["getExtension"]
      >,

    hostProtocols: (record) => {
      const protocols = (record as { protocols?: unknown }).protocols;
      return Array.isArray(protocols)
        ? (protocols as string[])
        : record.enableSsh !== false
          ? ["ssh"]
          : [];
    },

    useHostStatus(hostId) {
      const statuses = useFrameState((state) => state.hostStatus);
      if (hostId === undefined) return null;
      return (statuses[String(hostId)] as HostStatusInfo | undefined) ?? null;
    },

    useHostActions() {
      const actions = useFrameState((state) => state.hostActions);
      return useMemo(
        () =>
          actions.map((action) => ({
            ...action,
            icon: decodeIcon(action.icon),
          })) as unknown as HostActionContribution[],
        [actions],
      );
    },

    useCompanions(tabType) {
      const companions = useFrameState((state) => state.companions);
      return useMemo(
        () =>
          companions
            .filter((entry) => {
              const types = entry.tabTypes as string[] | undefined;
              return !types?.length || types.includes(tabType);
            })
            .map((entry) => ({
              id: String(entry.id),
              titleKey: String(entry.titleKey ?? entry.id),
              icon: decodeIcon(entry.icon),
            })) as unknown as CompanionInfo[],
        [companions, tabType],
      );
    },

    useActivityTypes: () => useFrameState((state) => state.activityTypes),

    activityTarget(type) {
      const target = getFrameState().activityTargets[type];
      if (!target) return undefined;
      return {
        tab: target.tab,
        titleKey: target.titleKey,
        icon: decodeIcon(target.icon),
      } as ActivityTargetInfo;
    },

    usePluginUiPreferences(pluginId) {
      const all = useFrameState((state) => state.uiPreferences);
      const scope = usePluginScope();
      const values = (all[pluginId] as Record<string, unknown>) ?? {};
      return {
        values,
        set: (name, value) => {
          if (scope !== pluginId) return;
          void call("uiPreferences.set", name, value);
        },
      };
    },

    core: {
      ...pluginHostBridge.core,
      getHostPassword: async (hostId, field) =>
        (await call("hostPassword", hostId, field)) as string | null,
      patchOpenTab: async (instanceId, updates) => {
        await call("tabs.patch", instanceId, updates);
      },
      runKeybindingAction: (action, context) => {
        void call("keybinding.run", action, context);
        return true;
      },
      getClientPreference: () => undefined,
      setClientPreference: () => {},
      listHosts: async () => (await call("hosts.list")) as PluginHostRecord[],
      notifyHostsChanged: () => void call("hosts.changed"),
      getHostStatusColorScheme: () => getFrameState().statusColorScheme,
      getLocalAuthToken: () => null,
    },
  };
}
