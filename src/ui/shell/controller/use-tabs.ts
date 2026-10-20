/* eslint-disable react-hooks/exhaustive-deps */
import {
  createRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { TabHandle } from "@termix-ssh/plugin-sdk/frontend";
import type { ConfirmOptions } from "@/components/surface/surface-scope";
import type { Host, Tab, TabType } from "@/types/ui-types";
import {
  addOpenTab,
  createSSHHost,
  deleteOpenTab,
  getActiveSessions,
  getOpenTabs,
  patchOpenTab,
  type OpenTabRecord,
  type UserPreferences,
} from "@/main-axios";
import { createId } from "@/lib/create-id";
import { quickConnectHostToPayload } from "@/sidebar/quick-connect-host";
import { railItemLabel } from "@/sidebar/rail-items";
import { resolveHostTabType } from "@/lib/host-connection-tabs";
import { reconnectDisconnectedTabs } from "@/shell/reconnect-tabs";
import { canCloseTab } from "@/shell/tab-close-guards";
import {
  canRestoreTabType,
  getTabType,
  isPersistentTabType,
  isSessionTabType,
} from "@/shell/tab-registry";
import {
  requestFromLegacyEvent,
  requestManage,
} from "@/manage/manage-requests";
import {
  addSplitTab,
  canJoinSplit,
  isSplitTab,
  makeSplitTab,
  placeTabInPane,
  removeTab,
  restoreSplitTabs,
  serializeSplitTabs,
} from "@/shell/split/split-tabs";
import {
  createSplitState,
  findPane,
  listPanes,
} from "@/shell/split/split-tree";
import { fromLegacyConfig } from "@/shell/split/split-presets";
import {
  notifyShellReady,
  notifyTabsChanged,
} from "@/plugin-host/shell-bridge";
import {
  OPEN_PLUGINS_EVENT,
  OPEN_PLUGIN_SETTINGS_EVENT,
} from "@/plugins/open-plugins";
import type { OpenTabOptions, RestoreTarget } from "./types";

const PENDING_TARGET_MS = 60_000;

export function dashboardTab(label: string): Tab {
  return {
    id: "dashboard",
    instanceId: "dashboard",
    type: "dashboard",
    label,
    openedAt: Date.now(),
  };
}

/** What the tab code needs from the split code, filled in by useSplit. */
export interface SplitOps {
  unsplit: (splitTabId: string) => void;
  closePaneOf: (splitTabId: string, paneId: string) => void;
}

export function useSplitLabel() {
  const { t } = useTranslation();
  return (number: number) => t("splitScreen.defaultLabel", { number });
}

export function useTabs({
  hosts,
  hostsRef,
  hostsLoaded,
  reloadHosts,
  userPrefs,
  userPrefsLoaded,
  pluginsSettled,
  confirmRef,
  layoutDeps,
}: {
  hosts: Host[];
  hostsRef: MutableRefObject<Host[]>;
  hostsLoaded: boolean;
  reloadHosts: () => Promise<void>;
  userPrefs: UserPreferences;
  userPrefsLoaded: boolean;
  pluginsSettled: boolean;
  confirmRef: MutableRefObject<
    ((options: ConfirmOptions) => Promise<boolean>) | null
  >;
  /** Region state whose change also counts as a layout change for plugins. */
  layoutDeps: unknown[];
}) {
  const { t } = useTranslation();
  const splitLabel = useSplitLabel();
  const [tabs, setTabs] = useState<Tab[]>([dashboardTab(t("nav.dashboard"))]);
  const [activeTabId, setActiveTabId] = useState("dashboard");
  // Flips to true once the initial DB read (restore or skip) is done. Sync must not fire before this
  const [tabsReady, setTabsReady] = useState(false);
  const [backgroundTabRecords, setBackgroundTabRecords] = useState<
    OpenTabRecord[]
  >([]);
  // Split tabs are restored once their child tabs have stable live ids.
  const paneLayoutRestoredRef = useRef(false);
  const splitTabsRestoredRef = useRef(false);
  const splitOpsRef = useRef<SplitOps>({
    unsplit: () => {},
    closePaneOf: () => {},
  });

  useEffect(() => {
    if (!splitTabsRestoredRef.current) return;
    localStorage.setItem(
      "termix_splitTabs",
      JSON.stringify(serializeSplitTabs(tabs)),
    );
  }, [tabs]);

  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const closeActiveTabRef = useRef<() => void>(() => {});
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const terminalRefs = useRef<Map<string, ReturnType<typeof createRef>>>(
    new Map(),
  );

  /** The tab the user is working in: the focused pane's inside a split. */
  function focusedSessionTabId(): string | null {
    const id = activeTabIdRef.current;
    const active = tabsRef.current.find((tab) => tab.id === id);
    if (!isSplitTab(active)) return id || null;
    return findPane(active.split, active.split.focusedPaneId)?.tabId ?? null;
  }

  // ─── Where opened tabs go ─────────────────────────────────────────────────

  /**
   * The pane the next opened tab should fill, set when the user picks one
   * (the empty pane picker, "Open in split"). `fresh` marks a pane created in
   * the same click, which the last committed tabs do not show yet.
   */
  const pendingPaneTargetRef = useRef<{
    splitTabId: string;
    paneId: string;
    at: number;
    fresh: boolean;
  } | null>(null);
  // Set while a saved layout is applied, so its tabs stay where it puts them.
  const suppressPaneTargetRef = useRef(false);

  function targetPane(splitTabId: string, paneId: string, fresh = false) {
    pendingPaneTargetRef.current = {
      splitTabId,
      paneId,
      at: Date.now(),
      fresh,
    };
  }

  /**
   * Shows a newly opened (or re-focused) tab. It fills the pane the user
   * picked, else the focused pane of the active split when that is empty,
   * else it simply becomes the active tab.
   */
  const placeOpenedTabRef = useRef<(tabId: string) => void>(() => {});
  placeOpenedTabRef.current = (tabId: string) => {
    const current = tabsRef.current;
    const pending = pendingPaneTargetRef.current;
    pendingPaneTargetRef.current = null;
    if (suppressPaneTargetRef.current || tabId === "dashboard") {
      setActiveTabId(tabId);
      return;
    }
    const existing = current.find((tab) => tab.id === tabId);

    let target: { splitTabId: string; paneId: string } | null = null;
    if (pending && Date.now() - pending.at < PENDING_TARGET_MS) {
      const split = current.find((tab) => tab.id === pending.splitTabId);
      if (
        pending.fresh ||
        (isSplitTab(split) && findPane(split.split, pending.paneId))
      ) {
        target = pending;
      }
    }
    // Opening a session that already sits in a split shows it there.
    if (!target && existing?.parentSplitTabId) {
      setActiveTabId(tabId);
      return;
    }
    if (!target) {
      const active = current.find((tab) => tab.id === activeTabIdRef.current);
      if (isSplitTab(active)) {
        const focused = findPane(active.split, active.split.focusedPaneId);
        if (focused && focused.tabId === null) {
          target = { splitTabId: active.id, paneId: focused.id };
        }
      }
    }
    if (!target || (existing && !canJoinSplit(existing))) {
      setActiveTabId(tabId);
      return;
    }
    const { splitTabId, paneId } = target;
    setTabs((prev) => placeTabInPane(prev, splitTabId, paneId, tabId));
    setActiveTabId(splitTabId);
  };

  // Panels that type into a terminal act on "the terminal you're working in".
  // Once those panels can themselves be the active tab, activeTabId points at
  // the panel and the lookup misses, so remember the last terminal instead.
  // In a split, the tab being worked in is the focused pane's.
  const workingTabId = (() => {
    const active = tabs.find((t) => t.id === activeTabId);
    if (!isSplitTab(active)) return activeTabId;
    return findPane(active.split, active.split.focusedPaneId)?.tabId ?? "";
  })();
  const [lastTerminalTabId, setLastTerminalTabId] = useState(activeTabId);
  useEffect(() => {
    const working = tabs.find((t) => t.id === workingTabId);
    if (working && getTabType(working.type)?.commandTarget) {
      setLastTerminalTabId(working.id);
    }
  }, [workingTabId, tabs]);

  const [showTabNumbers, setShowTabNumbers] = useState<boolean>(
    () => localStorage.getItem("showTabNumbers") === "true",
  );
  useEffect(() => {
    const handler = () => {
      setShowTabNumbers(localStorage.getItem("showTabNumbers") === "true");
    };
    window.addEventListener("showTabNumbersChanged", handler);
    return () => window.removeEventListener("showTabNumbersChanged", handler);
  }, []);

  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab?.terminalRef) return;
    let innerRafId: number;
    const outerRafId = requestAnimationFrame(() => {
      innerRafId = requestAnimationFrame(() => {
        const ref = activeTab.terminalRef?.current;
        ref?.fit?.();
        ref?.notifyResize?.();
        ref?.refresh?.();
      });
    });
    return () => {
      cancelAnimationFrame(outerRafId);
      cancelAnimationFrame(innerRafId);
    };
  }, [activeTabId]);

  // Sync tab host data when hosts update (e.g. after editing terminal theme in host settings)
  useEffect(() => {
    if (hosts.length === 0) return;
    const byId = new Map(hosts.map((h) => [h.id, h]));
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        const fresh = t.host ? byId.get(t.host.id) : undefined;
        if (!fresh || fresh === t.host) return t;
        // A reload hands back new objects; only replace hosts that changed so
        // untouched tabs keep their identity and skip a re-render.
        if (JSON.stringify(fresh) === JSON.stringify(t.host)) return t;
        changed = true;
        return { ...t, host: fresh };
      });
      return changed ? next : prev;
    });
  }, [hosts]);

  // On load: always read saved tabs from DB so background sessions are preserved across refreshes.
  // If reopenTabsOnLogin is on, also restore them as open tabs in the tab bar.
  const tabRestoreAttemptedRef = useRef(false);
  useEffect(() => {
    // Waits for plugins too, so a plugin's saved tabs come back as themselves.
    if (!hostsLoaded || !userPrefsLoaded || !pluginsSettled) return;
    if (tabRestoreAttemptedRef.current) return;
    tabRestoreAttemptedRef.current = true;

    async function loadSavedTabs() {
      try {
        const [savedTabs, activeSessions] = await Promise.all([
          getOpenTabs(),
          getActiveSessions(),
        ]);

        if (!Array.isArray(savedTabs) || savedTabs.length === 0) return;

        const sessionByInstanceId = new Map(
          (Array.isArray(activeSessions) ? activeSessions : [])
            .filter((s) => s.tabInstanceId != null)
            .map((s) => [s.tabInstanceId, s]),
        );

        if (userPrefs.reopenTabsOnLogin) {
          const hasPersistentTabs = tabs.some((t) =>
            isPersistentTabType(t.type),
          );
          if (!hasPersistentTabs) {
            const restoredTabs: Tab[] = [];
            for (const saved of savedTabs as OpenTabRecord[]) {
              const host = saved.hostId
                ? hosts.find((h) => h.id === String(saved.hostId))
                : undefined;
              if (!canRestoreTabType(saved.tabType, host)) continue;

              // Singleton tabs use their type as the stable ID; host-bound tabs get a unique ID
              const tabId = host
                ? `${host.name}-${saved.tabType}-${Date.now()}-${saved.tabOrder}`
                : saved.id;
              const liveSession = sessionByInstanceId.get(saved.id);
              const restoredSessionId =
                liveSession?.sessionId ?? saved.backendSessionId ?? null;

              const isCustomLabel =
                host &&
                saved.label !== host.name &&
                !/^.+ \(\d+\)$/.test(saved.label);

              restoredTabs.push({
                id: tabId,
                instanceId: saved.id,
                type: saved.tabType as TabType,
                label: saved.label,
                customLabel: isCustomLabel ? saved.label : undefined,
                host,
                openedAt: new Date(saved.createdAt).getTime(),
                restoredSessionId,
                terminalRef: isSessionTabType(saved.tabType)
                  ? createRef()
                  : undefined,
              });
            }

            if (restoredTabs.length > 0) {
              setTabs((prev) => {
                const existingIds = new Set(prev.map((t) => t.id));
                const newTabs = restoredTabs.filter(
                  (t) => !existingIds.has(t.id),
                );
                return newTabs.length > 0 ? [...prev, ...newTabs] : prev;
              });
              setActiveTabId(restoredTabs[0].id);
            }
            // Restored tabs are in the tab bar, not in background records
          }
        } else {
          // Not restoring to tab bar, keep as background records for ConnectionsPanel
          setBackgroundTabRecords(savedTabs as OpenTabRecord[]);
        }
      } catch {
        // silently fail
      } finally {
        setTabsReady(true);
      }
    }

    loadSavedTabs();
  }, [hostsLoaded, userPrefsLoaded, pluginsSettled]);

  // Plugins that act once the session is back (the workspaces plugin applies
  // a default workspace) wait for this.
  useEffect(() => {
    if (tabsReady) notifyShellReady();
  }, [tabsReady]);

  // Restore split tabs once their child sessions have stable live ids. The
  // oldest single-split keys are migrated once into a first split.
  useEffect(() => {
    if (!tabsReady || paneLayoutRestoredRef.current) return;
    paneLayoutRestoredRef.current = true;

    try {
      const savedSplitTabs = JSON.parse(
        localStorage.getItem("termix_splitTabs") ?? "[]",
      ) as unknown;
      if (Array.isArray(savedSplitTabs) && savedSplitTabs.length > 0) {
        setTabs((prev) => restoreSplitTabs(savedSplitTabs, prev));
        return;
      }

      const savedInstanceIds = JSON.parse(
        localStorage.getItem("termix_paneInstanceIds") ?? "null",
      ) as unknown;
      const savedMode = localStorage.getItem("termix_splitMode");
      if (!Array.isArray(savedInstanceIds) || !savedMode) return;
      const savedSizes = JSON.parse(
        localStorage.getItem("termix_paneSizes") ?? "null",
      ) as { rowSizes?: unknown; rowColSizes?: unknown } | null;
      const tabIdByInstanceId = new Map(
        tabs.map((tab) => [tab.instanceId, tab.id]),
      );
      const root = fromLegacyConfig(
        savedMode,
        savedInstanceIds.map((instanceId) =>
          typeof instanceId === "string"
            ? (tabIdByInstanceId.get(instanceId) ?? null)
            : null,
        ),
        savedSizes?.rowSizes,
        savedSizes?.rowColSizes,
      );
      if (root && listPanes(root).some((pane) => pane.tabId)) {
        const splitTab = makeSplitTab(
          createId(),
          splitLabel(1),
          createSplitState(root),
        );
        setTabs((prev) => addSplitTab(prev, splitTab));
        setActiveTabId(splitTab.id);
      }
    } catch {
      // silently fail
    } finally {
      splitTabsRestoredRef.current = true;
      localStorage.removeItem("termix_splitMode");
      localStorage.removeItem("termix_paneInstanceIds");
      localStorage.removeItem("termix_paneSizes");
    }
  }, [tabsReady, tabs]);

  // Debounced tab-order sync: when tab order changes, patch each persistent tab's tabOrder in DB.
  const orderSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const prevTabOrderRef = useRef<string>("");
  useEffect(() => {
    if (!tabsReady) return;
    const persistable = tabs.filter((t) => isPersistentTabType(t.type));
    const orderKey = persistable.map((t) => t.instanceId).join(",");
    if (orderKey === prevTabOrderRef.current) return;
    prevTabOrderRef.current = orderKey;

    if (orderSyncTimeoutRef.current) clearTimeout(orderSyncTimeoutRef.current);
    orderSyncTimeoutRef.current = setTimeout(() => {
      persistable.forEach((t, i) => {
        patchOpenTab(t.instanceId, { tabOrder: i }).catch(() => {});
      });
    }, 500);

    return () => {
      if (orderSyncTimeoutRef.current)
        clearTimeout(orderSyncTimeoutRef.current);
    };
  }, [tabs, tabsReady]);

  // Tells plugins the arrangement changed, e.g. so the workspaces plugin can
  // keep its last-session snapshot current.
  useEffect(() => {
    if (tabsReady) notifyTabsChanged();
  }, [tabs, tabsReady, ...layoutDeps]);

  // ─── Tab management ──────────────────────────────────────────────────────

  const openTab = useCallback(function openTab(
    host: Host,
    type: TabType,
    restore?: RestoreTarget,
    options?: OpenTabOptions,
  ) {
    if (!restore && !options?.forceNewTab) {
      const dataKey = JSON.stringify(options?.data ?? null);
      const existing = tabsRef.current.find(
        (t) =>
          t.type === type &&
          t.host?.id === host.id &&
          JSON.stringify(t.data ?? null) === dataKey,
      );
      if (existing) {
        placeOpenedTabRef.current(existing.id);
        return existing.id;
      }
    }
    const instanceId = restore?.instanceId ?? createId();
    // Unique per open; a timestamp collides when a workspace opens several
    // tabs in the same millisecond.
    const tabId = `${type}-${createId()}`;
    const openedAt = Date.now();
    const ref = isSessionTabType(type) ? createRef() : undefined;
    if (ref) terminalRefs.current.set(tabId, ref);

    let finalLabel = host.name;
    const savedLabel = restore?.savedLabel;
    // A saved label that doesn't match the bare host name or the auto-numbered pattern is a custom label
    const isCustomLabel =
      savedLabel != null &&
      savedLabel !== host.name &&
      !/^.+ \(\d+\)$/.test(savedLabel);

    setTabs((prev) => {
      if (isCustomLabel && savedLabel) {
        finalLabel = savedLabel;
        return [
          ...prev,
          {
            id: tabId,
            instanceId,
            type,
            label: finalLabel,
            customLabel: finalLabel,
            host,
            openedAt,
            terminalRef: ref,
            restoredSessionId: restore?.restoredSessionId ?? null,
            data: options?.data,
          },
        ];
      }

      const same = prev.filter(
        (t) =>
          t.type === type && t.label.replace(/ \(\d+\)$/, "") === host.name,
      );
      finalLabel = options?.label
        ? options.label
        : same.length === 0
          ? host.name
          : `${host.name} (${same.length + 1})`;

      // Retrofit the first duplicate's label to "(1)" if needed
      const next =
        same.length === 1 && !/\(\d+\)$/.test(same[0].label)
          ? prev.map((t) =>
              t.id === same[0].id ? { ...t, label: `${host.name} (1)` } : t,
            )
          : prev;

      return [
        ...next,
        {
          id: tabId,
          instanceId,
          type,
          label: finalLabel,
          host,
          openedAt,
          terminalRef: ref,
          restoredSessionId: restore?.restoredSessionId ?? null,
          data: options?.data,
        },
      ];
    });
    placeOpenedTabRef.current(tabId);

    if (isPersistentTabType(type)) {
      addOpenTab({
        id: instanceId,
        tabType: type,
        hostId: host ? parseInt(host.id) : null,
        label: finalLabel,
        tabOrder: 0,
      }).catch(() => {});
    }

    return tabId;
  }, []);

  function connectHost(
    host: Host,
    preferredType?: TabType,
    options?: OpenTabOptions,
  ) {
    const type = resolveHostTabType(host, preferredType);
    if (!type) return;
    openTab(host, type, undefined, options);
  }

  const saveQuickConnectHost = useCallback(
    async (tab: Tab, host: Host) => {
      try {
        const savedHost = await createSSHHost(quickConnectHostToPayload(host));
        await patchOpenTab(tab.instanceId, { hostId: savedHost.id });
        await reloadHosts();
        toast.success(t("hosts.hostCreated"));
      } catch (error) {
        toast.error(t("hosts.failedToSave"));
        throw error;
      }
    },
    [reloadHosts, t],
  );

  /** A tab type that opens a fresh tab every time (a local shell). */
  function openMultiInstanceTab(
    type: TabType,
    options?: { host?: Host; data?: Record<string, unknown>; label?: string },
  ): string {
    const instanceId = createId();
    const id = `${type}-${instanceId}`;
    const titleKey = getTabType(type)?.titleKey;
    const title = options?.label ?? (titleKey ? t(titleKey) : type);
    setTabs((current) => {
      const count = current.filter((tab) => tab.type === type).length;
      return [
        ...current,
        {
          id,
          instanceId,
          type,
          label:
            count === 0 || options?.label ? title : `${title} (${count + 1})`,
          openedAt: Date.now(),
          ...(options?.host ? { host: options.host } : {}),
          ...(options?.data !== undefined ? { data: options.data } : {}),
        },
      ];
    });
    placeOpenedTabRef.current(id);
    return id;
  }

  const openSingletonTab = useCallback(
    // `host` optionally preselects a host for a singleton plugin tab.
    function openSingletonTab(
      type: TabType,
      pendingEvent?: string,
      host?: Host,
      data?: Record<string, unknown>,
      tabLabel?: string,
    ): string | undefined {
      // A local shell is never a singleton: each open is its own session.
      if (getTabType(type)?.multiInstance) {
        return openMultiInstanceTab(type, { host, data, label: tabLabel });
      }
      if (type === "host-manager" && pendingEvent) {
        const request = requestFromLegacyEvent(pendingEvent);
        if (request) requestManage(request);
      }
      // Profile and admin are pages of the one Settings tab now.
      if (type === "user-profile" || type === "admin-settings") {
        return openSingletonTab(
          "settings",
          undefined,
          undefined,
          {
            section:
              typeof data?.section === "string"
                ? data.section
                : type === "admin-settings"
                  ? "admin-general"
                  : "account",
          },
          tabLabel,
        );
      }
      // Asking for a page again still goes there after the user moved away
      if (type === "settings" && data?.section && data.revealAt === undefined) {
        data = { ...data, revealAt: Date.now() };
      }
      const id = type;
      const singletonLabels: Partial<Record<TabType, string>> = {
        "host-manager": t("nav.manage"),
        settings: t("nav.settings"),
        plugins: t("nav.plugins"),
      };
      // A plugin tab names itself; promoted rail panels reuse the rail's own
      // label so the two stay in sync.
      const titleKey = getTabType(type)?.titleKey;
      const label =
        singletonLabels[type] ??
        (titleKey ? t(titleKey) : railItemLabel(type, t));
      setTabs((prev) => {
        const existing = prev.find((t) => t.id === id);
        if (existing) {
          // Refocusing a singleton with a host or data passes it on.
          if (!host && data === undefined) return prev;
          return prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  ...(host ? { host } : {}),
                  ...(data !== undefined ? { data } : {}),
                }
              : t,
          );
        }
        return [
          ...prev,
          {
            id,
            instanceId: id,
            type,
            label,
            openedAt: Date.now(),
            ...(host ? { host } : {}),
            ...(data !== undefined ? { data } : {}),
          },
        ];
      });
      placeOpenedTabRef.current(id);
      if (isPersistentTabType(type)) {
        addOpenTab({
          id,
          tabType: type,
          hostId: null,
          label,
          tabOrder: 0,
        }).catch(() => {});
      }
      return id;
    },
    [t],
  );

  const openSingletonTabRef = useRef(openSingletonTab);
  openSingletonTabRef.current = openSingletonTab;

  useEffect(() => {
    const handler = () => openSingletonTabRef.current("plugins");
    window.addEventListener(OPEN_PLUGINS_EVENT, handler);
    return () => window.removeEventListener(OPEN_PLUGINS_EVENT, handler);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const pluginId = (event as CustomEvent<string>).detail;
      if (typeof pluginId !== "string") return;
      openSingletonTabRef.current("settings", undefined, undefined, {
        section: `plugin:${pluginId}`,
        revealAt: Date.now(),
      });
    };
    window.addEventListener(OPEN_PLUGIN_SETTINGS_EVENT, handler);
    return () =>
      window.removeEventListener(OPEN_PLUGIN_SETTINGS_EVENT, handler);
  }, []);

  const getTabCloseLabel = useCallback((tab: Tab) => {
    return tab.customLabel || tab.label || tab.host?.name || String(tab.id);
  }, []);

  const isActiveConnectionTab = useCallback((tab: Tab) => {
    if (!isSessionTabType(tab.type)) return false;
    return tab.terminalRef?.current?.isConnected?.() === true;
  }, []);

  const hasActiveConnection = useCallback(() => {
    return tabsRef.current.some(isActiveConnectionTab);
  }, [isActiveConnectionTab]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasActiveConnection()) return;

      event.preventDefault();
      event.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasActiveConnection]);

  const doCloseTabRef = useRef<(id: string) => void>(() => {});
  doCloseTabRef.current = doCloseTab;
  function doCloseTab(id: string) {
    const tabToClose = tabs.find((t) => t.id === id);
    if (tabToClose?.terminalRef?.current?.disconnect) {
      tabToClose.terminalRef.current.disconnect();
    }
    if (tabToClose?.instanceId && isPersistentTabType(tabToClose.type)) {
      deleteOpenTab(tabToClose.instanceId).catch(() => {});
    }

    terminalRefs.current.delete(id);
    if (isSplitTab(tabToClose)) {
      splitOpsRef.current.unsplit(id);
      return;
    }
    if (id === activeTabId) {
      const remaining = tabs.filter(
        (tab) => tab.id !== id && !tab.parentSplitTabId,
      );
      setActiveTabId(
        remaining.length > 0 ? remaining[remaining.length - 1].id : "dashboard",
      );
    }
    setTabs((prev) => {
      // A pane that held the tab stays, empty and focused, ready for the next one.
      const next = removeTab(prev, id);
      if (next.length === 0) return [dashboardTab(t("nav.dashboard"))];
      return next;
    });
  }

  function reconnectAllDisconnected() {
    const { reconnected, failed } = reconnectDisconnectedTabs(tabsRef.current);
    if (reconnected || !failed)
      toast(
        t(
          reconnected
            ? "nav.reconnectingTerminals"
            : "nav.noDisconnectedTerminals",
          { count: reconnected },
        ),
      );
    if (failed)
      toast.error(t("nav.reconnectTerminalsFailed", { count: failed }));
  }
  const reconnectAllRef = useRef<() => void>(() => {});
  reconnectAllRef.current = reconnectAllDisconnected;

  function refreshTab(id: string) {
    const tab = tabs.find((t) => t.id === id);
    const handle = tab?.terminalRef?.current;
    if (!handle) return;
    // Session tabs expose one or the other on their handle.
    if (handle.reconnect) handle.reconnect();
    else handle.refresh?.();
  }

  async function closeTab(id: string) {
    const tab = tabsRef.current.find((t) => t.id === id);
    const guard = tab?.terminalRef?.current?.confirmClose;
    if (guard && !(await guard())) return;
    if (!(await canCloseTab(id))) return;
    const confirmEnabled = localStorage.getItem("confirmTabClose") === "true";
    if (tab && confirmEnabled && isActiveConnectionTab(tab)) {
      const ask = confirmRef.current;
      const ok = ask
        ? await ask({
            title: t("nav.confirmCloseHost", { host: getTabCloseLabel(tab) }),
            confirmLabel: t("nav.close"),
          })
        : true;
      if (!ok) return;
    }
    doCloseTabRef.current(id);
  }

  // In a split, closing acts on the focused pane: its session, or the pane
  // itself once it is empty.
  closeActiveTabRef.current = () => {
    const id = activeTabIdRef.current;
    const active = tabsRef.current.find((tab) => tab.id === id);
    if (isSplitTab(active)) {
      const tabId = focusedSessionTabId();
      if (tabId) closeTab(tabId);
      else
        splitOpsRef.current.closePaneOf(active.id, active.split.focusedPaneId);
      return;
    }
    if (id !== "dashboard") closeTab(id);
  };

  function renameTab(tabId: string, newLabel: string) {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, customLabel: newLabel, label: newLabel } : t,
      ),
    );
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.instanceId && tab.type !== "split-screen") {
      patchOpenTab(tab.instanceId, { label: newLabel }).catch(() => {});
    }
  }

  function reorderTopLevelTabs(reordered: Tab[]) {
    setTabs((prev) => [
      ...reordered,
      ...prev.filter((tab) => tab.parentSplitTabId),
    ]);
  }

  const terminalTabs = tabs.filter((t) => getTabType(t.type)?.commandTarget);
  // What command-target panels act on. Falls back to the remembered
  // terminal when the active tab isn't one, and drops it once it's closed.
  const targetTerminalTabId = terminalTabs.some((t) => t.id === workingTabId)
    ? workingTabId
    : terminalTabs.some((t) => t.id === lastTerminalTabId)
      ? lastTerminalTabId
      : "";

  return {
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    tabsReady,
    backgroundTabRecords,
    setBackgroundTabRecords,
    tabsRef,
    activeTabIdRef,
    closeActiveTabRef,
    reconnectAllRef,
    terminalRefs,
    splitOpsRef,
    suppressPaneTargetRef,
    pendingPaneTargetRef,
    openSingletonTabRef,
    hostsRef,
    focusedSessionTabId,
    targetPane,
    openTab,
    connectHost,
    saveQuickConnectHost,
    openMultiInstanceTab,
    openSingletonTab,
    doCloseTab,
    closeTab,
    renameTab,
    refreshTab,
    reconnectAllDisconnected,
    reorderTopLevelTabs,
    showTabNumbers,
    terminalTabs,
    targetTerminalTab: terminalTabs.find((t) => t.id === targetTerminalTabId),
    handleFor: (id: string) =>
      terminalRefs.current.get(id)?.current as TabHandle | null | undefined,
  };
}

export type TabsState = ReturnType<typeof useTabs>;
