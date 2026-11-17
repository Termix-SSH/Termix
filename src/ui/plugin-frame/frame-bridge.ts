/**
 * The SDK bridge inside a frame. Most hooks work as they do in the page,
 * because their core reads go through the frame's network to the shell's
 * checked list. What lives in the shell itself (hosts, tabs, theme, toasts,
 * actions, other plugins' parts) comes from state the shell pushes, or a
 * call to it.
 */

import { useMemo, useSyncExternalStore } from "react";
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
import { addStrings } from "./foreign-client";

/** Puts the titles the shell translated under their keys in this frame. */
function addTitles(entries: Record<string, unknown>[]): void {
  const strings: Record<string, string> = {};
  for (const entry of entries) {
    if (typeof entry.titleKey === "string" && typeof entry.title === "string") {
      strings[entry.titleKey] = entry.title;
    }
  }
  addStrings(strings);
}
import type { ForeignRuntime } from "@/components/foreign/foreign-runtime";
import { useFrameShell } from "./frame-shell";
import { getFrameState, useFrameState } from "./frame-store";

export interface FrameBridgeHost {
  pluginId: string;
  call: (method: string, ...args: unknown[]) => Promise<unknown>;
  getApi: PluginHostBridge["getApi"];
  tabs: TabsApi;
  foreign: ForeignRuntime;
}

/**
 * Which host actions the shell said apply to each host, per list the shell
 * sent. A new list (a plugin's when changed) asks again.
 */
const hostActionAnswers = new WeakMap<
  object,
  Map<string, Set<string> | null>
>();
const answerListeners = new Set<() => void>();
let answerVersion = 0;

function visibleHostActions(list: object): Map<string, Set<string> | null> {
  let map = hostActionAnswers.get(list);
  if (!map) {
    map = new Map();
    hostActionAnswers.set(list, map);
  }
  return map;
}

function subscribeAnswers(listener: () => void): () => void {
  answerListeners.add(listener);
  return () => answerListeners.delete(listener);
}

function answered(): void {
  answerVersion++;
  for (const listener of answerListeners) listener();
}

export function createFrameBridge(host: FrameBridgeHost): PluginHostBridge {
  const call = host.call;
  const showTab = (id: string) => void call("tabs.show", id).catch(() => {});
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

    useShell: () => useFrameShell(host.tabs, showTab),

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

    // Other plugins' parts come from the shell as placeholders it draws
    // over. The frame's own extensions draw here as they are.
    useSlotContributions: (slotId, context) =>
      host.foreign.useSlot(slotId, context) as ReturnType<
        PluginHostBridge["useSlotContributions"]
      >,
    usePluginComponent: (id) => host.foreign.useComponent(id),
    useExtensions: (pointId) => {
      const own = useOwnExtensions(pointId);
      const foreign = host.foreign.useExtensions(pointId);
      return useMemo(
        () => [...own, ...foreign],
        [own, foreign],
      ) as unknown as ReturnType<PluginHostBridge["useExtensions"]>;
    },
    getExtension: (pointId, id) =>
      (getOwnExtension(pointId, id) ??
        host.foreign.getExtension(pointId, id)) as ReturnType<
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
      const version = useSyncExternalStore(
        subscribeAnswers,
        () => answerVersion,
      );
      return useMemo(() => {
        void version;
        addTitles(actions);
        const visible = visibleHostActions(actions);
        const ask = (hostId: string) => {
          if (visible.has(hostId)) return;
          visible.set(hostId, null);
          call("hostActions.when", hostId).then(
            (pairs) => {
              visible.set(
                hostId,
                new Set(
                  (Array.isArray(pairs) ? pairs : []).map((pair) =>
                    JSON.stringify(pair),
                  ),
                ),
              );
              answered();
            },
            () => visible.delete(hostId),
          );
        };
        return actions.map((action) => {
          const id = JSON.stringify([action.pluginId ?? "", action.id]);
          return {
            ...action,
            icon: decodeIcon(action.icon),
            when: (record: { id?: unknown } | null | undefined) => {
              if (record?.id === undefined || record.id === null) return false;
              const hostId = String(record.id);
              ask(hostId);
              return visible.get(hostId)?.has(id) ?? false;
            },
            run: (record: { id?: unknown } | null | undefined) =>
              void call(
                "hostActions.run",
                action.pluginId ?? "",
                action.id,
                String(record?.id),
              ).catch(() => {}),
          };
        }) as unknown as HostActionContribution[];
      }, [actions, version]);
    },

    useCompanions(tabType) {
      const companions = useFrameState((state) => state.companions);
      return useMemo(
        () =>
          (addTitles(companions), companions)
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
