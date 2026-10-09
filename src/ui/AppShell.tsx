/* eslint-disable react-refresh/only-export-components */
/* eslint-disable react-hooks/exhaustive-deps */
import type { TabHandle } from "@termix-ssh/plugin-sdk/frontend";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent } from "@/components/sheet";
import { Columns2, Maximize2, RotateCcw, Rows2, X } from "lucide-react";
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  createRef,
  lazy,
  Suspense,
} from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { resetPermissionsCache } from "@/hooks/use-permissions";
import { MobileBar } from "@/shell/MobileBar";
import { AppRail, type RailView } from "@/sidebar/AppRail";
import { ComponentSlot } from "@/shell/ActionSlot";
import {
  isCoreRailView,
  railItemLabel,
  promotableIds,
  rightDockableIds,
  useRailItems,
} from "@/sidebar/rail-items";
import {
  DOCK_DEFAULT_WIDTH,
  DockPanel,
  DockReopenStrip,
} from "@/shell/DockPanel";
import {
  SurfaceScope,
  useConfirm,
  type ConfirmOptions,
  type EditingWidth,
} from "@/components/surface/surface-scope";
import { OnboardingHost } from "@/onboarding/OnboardingHost";
import { SplitView, type SplitViewActions } from "@/shell/split/SplitView";
import { SplitDropOverlay } from "@/shell/split/SplitDropOverlay";
import {
  EmptyPanePicker,
  type PickHostTarget,
} from "@/shell/split/EmptyPanePicker";
import { renderTabContent } from "@/shell/tabUtils";
import { TabBar } from "@/shell/TabBar";
import { reconnectDisconnectedTabs } from "@/shell/reconnect-tabs";
import { canCloseTab } from "@/shell/tab-close-guards";
import {
  MANAGE_REQUEST_EVENT,
  type ManageMode,
  requestFromLegacyEvent,
  requestManage,
} from "@/manage/manage-requests";
import {
  dispatchCtrlW,
  createCommandPaletteShortcutMatcher,
  isShiftKey,
} from "@/lib/app-keyboard-shortcuts";
import { parseCustomKeybindings } from "@/api/open-tabs-api";
import { findMatchingKeybinding } from "@/lib/keybinding-match";
import type {
  CustomKeybinding,
  KeybindingActionType,
} from "@/types/keybindings";
import {
  GLOBAL_KEYBINDING_EVENT,
  getKeybindingAction,
  runKeybindingAction,
} from "@/shell/keybinding-registry";

// Shell surfaces that are not needed for first paint.
const CommandPalette = lazy(() =>
  import("@/shell/CommandPalette").then((m) => ({
    default: m.CommandPalette,
  })),
);
const HostsPanel = lazy(() =>
  import("@/sidebar/HostsPanel").then((m) => ({ default: m.HostsPanel })),
);
const QuickConnectPanel = lazy(() =>
  import("@/sidebar/QuickConnectPanel").then((m) => ({
    default: m.QuickConnectPanel,
  })),
);

const SyncPanel = lazy(() =>
  import("@/settings/sync/SyncPanel").then((m) => ({
    default: m.SyncPanel,
  })),
);
const CredentialsPanel = lazy(() =>
  import("@/sidebar/CredentialsPanel").then((m) => ({
    default: m.CredentialsPanel,
  })),
);
const ConnectionsPanel = lazy(() =>
  import("@/sidebar/ConnectionsPanel").then((m) => ({
    default: m.ConnectionsPanel,
  })),
);

function SidebarPanelFallback() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="size-5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground/70 animate-spin" />
    </div>
  );
}
import type {
  Tab,
  TabType,
  Host,
  HostFolder,
  ThemeId,
  FontSizeId,
  WorkspacePayload,
} from "@/types/ui-types";
import { applyAccentColor, applyFontSize } from "@/lib/theme";
import { globalShortcutHandler } from "@/lib/global-shortcut-handler";
import { getTabJumpDigit } from "@/lib/tab-jump-hotkey";
import { useTheme } from "@/components/theme-provider";
import {
  getSSHHosts,
  getSSHFolders,
  getUserInfo,
  getOpenTabs,
  addOpenTab,
  deleteOpenTab,
  patchOpenTab,
  createSSHHost,
  getActiveSessions,
  getUserPreferences,
  saveUserPreferences,
  dismissDonationModal,
  type UserPreferences,
  type OpenTabRecord,
} from "@/main-axios";
import {
  buildLayoutPayload,
  resolveLayoutSplits,
  resolveLayoutTabTarget,
  snapshotData,
} from "@/shell/shell-layout";
import { DonationReminderModal } from "@/user/DonationReminderModal.tsx";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { remScale } from "@/lib/rem";
import { dbHealthMonitor } from "@/lib/db-health-monitor";
import { ServerStatusProvider } from "@/lib/ServerStatusContext";
import { sshHostToHost } from "@/sidebar/HostManagerData";
import { resolveHostTabType } from "@/lib/host-connection-tabs";
import { changeAppLanguage, consumeLoginLanguage } from "@/i18n/i18n";
import { quickConnectHostToPayload } from "@/sidebar/quick-connect-host";
import { buildHostTree } from "@/sidebar/build-host-tree";
import {
  addSplitTab,
  canJoinSplit,
  closeSplitTab,
  isSplitTab,
  makeSplitTab,
  nextSplitNumber,
  placeTabInPane,
  removeTab,
  restoreSplitTabs,
  serializeSplitTabs,
  splitTabOf,
  summarizeSplits,
  updateSplit,
  type SplitTab,
  type TabSplitAction,
} from "@/shell/split/split-tabs";
import {
  addPaneAtEdge,
  assignTab,
  canAddPane,
  createPane,
  createSplitNode,
  createSplitState,
  equalizeSplit,
  findPane,
  findPaneByTab,
  focusPane,
  listPanes,
  MAX_PANES,
  movePane,
  neighborPane,
  removePane,
  resizeSplit,
  shownPanes,
  splitPane,
  swapPanes,
  toggleZoom,
  type NavDirection,
  type PaneEdge,
  type PaneRect,
  type SplitState,
} from "@/shell/split/split-tree";
import {
  applyPreset,
  buildPreset,
  fromLegacyConfig,
  type SplitPresetId,
} from "@/shell/split/split-presets";
import {
  setSplitDropHandler,
  type SplitDragSource,
  type SplitDropHover,
} from "@/shell/split/split-drag";
import {
  publishSplitTargets,
  setSplitOpener,
  type SplitOpenTarget,
} from "@/shell/split/split-targets";
import { registerPaletteEntry } from "@/shell/palette-registry";
import { createId } from "@/lib/create-id";
import {
  canRestoreTabType,
  getTabType,
  isPersistentTabType,
  isSessionTabType,
  useTabTypes,
  type TabShellCallbacks,
} from "@/shell/tab-registry";
import { runHostAction } from "@/sidebar/host-contributions";
import { getPanel, usePanels } from "@/shell/panel-registry";
import { usePluginStore } from "@/plugin-host/plugin-store";
import {
  notifyShellReady,
  notifyTabsChanged,
  setShellCallbacks,
  setShellHosts,
  setShellLayoutProvider,
} from "@/plugin-host/shell-bridge";
import { PluginViewPlaceholder } from "@/plugin-host/PluginViewPlaceholder";
import {
  OPEN_PLUGINS_EVENT,
  OPEN_PLUGIN_SETTINGS_EVENT,
} from "@/plugins/open-plugins";

export { buildHostTree } from "@/sidebar/build-host-tree";
export { tabIcon, renderTabContent } from "@/shell/tabUtils";

/** Hands the main area's confirm to code outside it, like closeTab. */
function ShellConfirmCapture({
  confirmRef,
}: {
  confirmRef: React.MutableRefObject<
    ((options: ConfirmOptions) => Promise<boolean>) | null
  >;
}) {
  const confirm = useConfirm();
  confirmRef.current = confirm;
  return null;
}

// ─── AppShell ────────────────────────────────────────────────────────────────

export function AppShell({
  username,
  onLogout,
}: {
  username: string;
  onLogout: (options?: { manual?: boolean }) => void;
}) {
  const { t, i18n } = useTranslation();
  const { setTheme } = useTheme();
  // Re-render when plugins add or remove rail items, panels or tabs.
  useRailItems();
  const registeredPanels = usePanels();
  const tabTypes = useTabTypes();
  const { settled: pluginsSettled } = usePluginStore();
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: "dashboard",
      instanceId: "dashboard",
      type: "dashboard",
      label: t("nav.dashboard"),
      openedAt: Date.now(),
    },
  ]);
  const [activeTabId, setActiveTabId] = useState("dashboard");
  const [userPrefs, setUserPrefs] = useState<UserPreferences>({
    reopenTabsOnLogin: false,
  });
  const [userPrefsLoaded, setUserPrefsLoaded] = useState(false);
  const [hostsLoaded, setHostsLoaded] = useState(false);
  // Flips to true once the initial DB read (restore or skip) is done. Sync must not fire before this
  const [tabsReady, setTabsReady] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  // Split tabs are restored once their child tabs have stable live ids.
  const paneLayoutRestoredRef = useRef(false);
  const splitTabsRestoredRef = useRef(false);
  const [realHostTree, setRealHostTree] = useState<HostFolder | null>(null);
  const [hostsLoading, setHostsLoading] = useState(true);
  const [allHosts, setAllHosts] = useState<Host[]>([]);
  const allHostsRef = useRef(allHosts);
  allHostsRef.current = allHosts;
  const [isAdmin, setIsAdmin] = useState(false);
  // The standalone desktop backend still owns system settings such as the
  // Tailscale API key, even though it has only one implicit user.
  const showAdminUI = isAdmin;
  const [showDonationModal, setShowDonationModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [backgroundTabRecords, setBackgroundTabRecords] = useState<
    OpenTabRecord[]
  >([]);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [railView, setRailView] = useState<RailView>("hosts");

  // Anything that asks to add or edit a host, a credential or host defaults
  // ends up in the Manage tab, whichever event it still speaks.
  useEffect(() => {
    const names = [
      "host-manager:add-host",
      "host-manager:edit-host",
      "host-manager:add-credential",
      "host-manager:show-credentials",
      "host-manager:edit-defaults",
      "termix:open-host-defaults",
    ];
    const handler = (e: Event) => {
      const request = requestFromLegacyEvent(e.type, (e as CustomEvent).detail);
      if (request) requestManage(request);
    };
    const open = () => openSingletonTabRef.current("host-manager");
    for (const name of names) window.addEventListener(name, handler);
    window.addEventListener(MANAGE_REQUEST_EVENT, open);
    return () => {
      for (const name of names) window.removeEventListener(name, handler);
      window.removeEventListener(MANAGE_REQUEST_EVENT, open);
    };
  }, []);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("termix_sidebarWidth");
    return saved ? parseInt(saved, 10) : 291;
  });
  const [sidebarDragging, setSidebarDragging] = useState(false);
  // How far each panel wants the sidebar widened: what the panel says itself,
  // and what its open inline views say.
  const [panelEditing, setPanelEditing] = useState<
    Record<string, EditingWidth>
  >({});
  const [scopeEditing, setScopeEditing] = useState<
    Record<string, EditingWidth>
  >({});
  const setPanelEditingFor = useCallback(
    (view: string, editing: EditingWidth) =>
      setPanelEditing((prev) =>
        prev[view] === editing ? prev : { ...prev, [view]: editing },
      ),
    [],
  );
  const setScopeEditingFor = useCallback(
    (view: string, editing: EditingWidth) =>
      setScopeEditing((prev) =>
        prev[view] === editing ? prev : { ...prev, [view]: editing },
      ),
    [],
  );
  const editingSetters = useRef(
    new Map<string, (editing: EditingWidth) => void>(),
  );
  const panelEditingSetter = (view: string) => {
    const key = `panel:${view}`;
    if (!editingSetters.current.has(key))
      editingSetters.current.set(key, (e) => setPanelEditingFor(view, e));
    return editingSetters.current.get(key)!;
  };
  const scopeEditingSetter = (view: string) => {
    const key = `scope:${view}`;
    if (!editingSetters.current.has(key))
      editingSetters.current.set(key, (e) => setScopeEditingFor(view, e));
    return editingSetters.current.get(key)!;
  };
  // The root confirm, for questions the shell itself asks (closing a tab).
  const shellConfirmRef = useRef<
    ((options: ConfirmOptions) => Promise<boolean>) | null
  >(null);

  // Right dock: a second panel column so reference panels like history can
  // stay visible while the left sidebar is used for something else.
  const [rightRailView, setRightRailView] = useState<RailView | null>(() => {
    const saved = localStorage.getItem("termix_rightRailView");
    return saved && rightDockableIds().includes(saved)
      ? (saved as RailView)
      : null;
  });
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("termix_rightSidebarWidth");
    return saved ? parseInt(saved, 10) : 291;
  });
  const [rightSidebarDragging, setRightSidebarDragging] = useState(false);
  // Remembers the last panel shown in the dock so the tab bar toggle can bring
  // it back instead of always falling back to the same default.
  const lastRightRailViewRef = useRef<string | null>(
    localStorage.getItem("termix_lastRightRailView"),
  );
  const [isAppFullscreen, setIsAppFullscreen] = useState(
    () => !!document.fullscreenElement,
  );

  useEffect(() => {
    localStorage.setItem("termix_sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem("termix_rightSidebarWidth", String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  useEffect(() => {
    if (rightRailView) {
      localStorage.setItem("termix_rightRailView", rightRailView);
      lastRightRailViewRef.current = rightRailView;
      localStorage.setItem("termix_lastRightRailView", rightRailView);
    } else {
      localStorage.removeItem("termix_rightRailView");
    }
  }, [rightRailView]);

  useEffect(() => {
    if (!splitTabsRestoredRef.current) return;
    localStorage.setItem(
      "termix_splitTabs",
      JSON.stringify(serializeSplitTabs(tabs)),
    );
  }, [tabs]);

  const isMobile = useIsMobile();
  const sidebarOpenBeforeMobile = useRef(sidebarOpen);
  useEffect(() => {
    if (isMobile) {
      sidebarOpenBeforeMobile.current = sidebarOpen;
      setSidebarOpen(false);
    } else {
      setSidebarOpen(sidebarOpenBeforeMobile.current);
    }
  }, [isMobile]);

  useEffect(() => {
    getUserInfo()
      .then((info) => {
        setIsAdmin(info.is_admin);
        setShowDonationModal(!!info.show_donation_modal);
      })
      .catch(() => setIsAdmin(false));
  }, []);

  const handleDismissDonationModal = useCallback(() => {
    setShowDonationModal(false);
    dismissDonationModal().catch(() => {});
  }, []);

  const toggleAppFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      if (!document.fullscreenEnabled) {
        toast.error(t("nav.fullscreenUnsupported"));
        return;
      }

      await document.documentElement.requestFullscreen();
    } catch {
      toast.error(t("nav.fullscreenFailed"));
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsAppFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const closeActiveTabRef = useRef<() => void>(() => {});
  const globalKeybindingsRef = useRef<CustomKeybinding[]>([]);
  // Split actions for handlers registered once, e.g. the global hotkeys.
  const splitActionsRef = useRef<{
    splitActive: (edge: "right" | "bottom") => void;
    navigate: (direction: NavDirection) => boolean;
    zoomFocused: () => boolean;
    closeFocusedPane: () => void;
  } | null>(null);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getUserPreferences()
        .then((prefs) => {
          if (cancelled) return;
          globalKeybindingsRef.current = parseCustomKeybindings(
            prefs.customKeybindings,
          ).filter((binding) => binding.enabled);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("customKeybindingsChanged", load);
    return () => {
      cancelled = true;
      window.removeEventListener("customKeybindingsChanged", load);
    };
  }, []);

  useEffect(() => {
    const runAction = (type: KeybindingActionType) => {
      if (type === "openCommandPalette") {
        setCommandPaletteOpen(true);
        return;
      }
      if (type === "reconnectSession") {
        const tabId = focusedSessionTabId();
        if (!tabId) return;
        const termRef = terminalRefs.current.get(tabId);
        (termRef?.current as TabHandle | null)?.reconnect?.();
        return;
      }
      const currentTabs = tabsRef.current.filter(
        (tab) => !tab.parentSplitTabId,
      );
      if (currentTabs.length < 2) return;
      const index = currentTabs.findIndex(
        (tab) => tab.id === activeTabIdRef.current,
      );
      const offset = type === "nextTab" ? 1 : -1;
      const next = (index + offset + currentTabs.length) % currentTabs.length;
      setActiveTabId(currentTabs[next].id);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-keybinding-recorder]")
      )
        return;
      // Only actions that run anywhere; a terminal's own are its to handle.
      const binding = findMatchingKeybinding(
        event,
        globalKeybindingsRef.current.filter(
          (entry) => getKeybindingAction(entry.action.type)?.scope === "global",
        ),
      );
      if (!binding) return;
      event.preventDefault();
      event.stopPropagation();
      runKeybindingAction(binding.action);
    };
    const handleAction = (event: Event) =>
      runAction(
        (event as CustomEvent<{ type: KeybindingActionType }>).detail.type,
      );

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener(GLOBAL_KEYBINDING_EVENT, handleAction);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener(GLOBAL_KEYBINDING_EVENT, handleAction);
    };
  }, []);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);
  useEffect(() => {
    return window.electronAPI?.onCloseActiveTab?.(() => {
      if (dispatchCtrlW(document.activeElement)) return;
      closeActiveTabRef.current();
    });
  }, []);
  /** The tab the user is working in: the focused pane's inside a split. */
  function focusedSessionTabId(): string | null {
    const id = activeTabIdRef.current;
    const active = tabsRef.current.find((tab) => tab.id === id);
    if (!isSplitTab(active)) return id || null;
    return findPane(active.split, active.split.focusedPaneId)?.tabId ?? null;
  }

  // ─── Where opened tabs go ─────────────────────────────────────────────────

  const PENDING_TARGET_MS = 60_000;
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
  const [commandPaletteShortcutEnabled, setCommandPaletteShortcutEnabled] =
    useState<boolean>(() => {
      const v = localStorage.getItem("commandPaletteShortcutEnabled");
      return v !== null ? v === "true" : true;
    });
  const [showTabNumbers, setShowTabNumbers] = useState<boolean>(
    () => localStorage.getItem("showTabNumbers") === "true",
  );
  const terminalRefs = useRef<Map<string, ReturnType<typeof createRef>>>(
    new Map(),
  );
  // Each shown pane's content element, by pane id. The version bump
  // re-renders so the placement effect moves tab nodes into new panes.
  const paneElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [, setPaneElsVersion] = useState(0);

  // Stable per-tab DOM nodes, created once per tab, never destroyed while the tab lives.
  // We always portal each tab's content into its own node, then move that node between
  // the normal-view container and the pane container via vanilla DOM so React's portal
  // target never changes (changing the target causes a remount).
  const tabNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const normalViewRef = useRef<HTMLDivElement>(null);
  // The area below the tab bar, where tabs and panes are dropped to split.
  const mainAreaRef = useRef<HTMLDivElement>(null);
  // Tab id the enter animation has already played for, so a re-render while
  // the tab stays active (there can be several right after a switch) doesn't
  // replay it, only a genuine switch to a different tab should.
  const lastAnimatedTabIdRef = useRef<string | null>(null);

  const getTabNode = useCallback((tabId: string, isTerminal: boolean) => {
    if (!tabNodesRef.current.has(tabId)) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.inset = "0";
      el.style.overflow = "hidden";
      if (!isTerminal) el.classList.add("bg-background");
      tabNodesRef.current.set(tabId, el);
    }
    return tabNodesRef.current.get(tabId)!;
  }, []);

  // Portal render order for tab content, kept independent of the tab bar's
  // visual order. Reordering tabs in the bar reorders `tabs`, and mapping
  // that array directly to portals reshuffles the Suspense-wrapped portal
  // children's sibling order in the fiber tree, React then runs its
  // Offscreen disconnect/reconnect pass on the ones that moved, which tears
  // down and rebuilds every passive effect underneath (including
  // react-xtermjs's terminal-creation effect), dropping the live terminal
  // and its WebSocket. Portal position doesn't need to track tab order at
  // all, so we only ever append new ids and drop closed ones here.
  const portalOrderRef = useRef<string[]>([]);
  {
    const liveIds = new Set(tabs.map((t) => t.id));
    portalOrderRef.current = portalOrderRef.current.filter((id) =>
      liveIds.has(id),
    );
    const known = new Set(portalOrderRef.current);
    for (const tab of tabs) {
      if (!known.has(tab.id)) portalOrderRef.current.push(tab.id);
    }
  }
  const tabsByPortalOrder = portalOrderRef.current
    .map((id) => tabs.find((t) => t.id === id))
    .filter((t): t is Tab => t !== undefined);

  const onPaneContentRef = useCallback(
    (paneId: string, el: HTMLDivElement | null) => {
      const els = paneElsRef.current;
      if (el) {
        if (els.get(paneId) === el) return;
        els.set(paneId, el);
      } else {
        if (!els.has(paneId)) return;
        els.delete(paneId);
      }
      setPaneElsVersion((version) => version + 1);
    },
    [],
  );

  // Titles come from the shared rail definitions so they stay translated and
  // in step with the rail itself.
  const sidebarTitle = (view: RailView): string => railItemLabel(view, t);

  // Double-shift or Ctrl+K opens the command palette. Double-shift alone was
  // hard to discover.
  useEffect(() => {
    if (!commandPaletteShortcutEnabled) return;
    const shortcut = createCommandPaletteShortcutMatcher();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!shortcut.matches(e)) return;
      if (!isShiftKey(e)) e.preventDefault();
      setCommandPaletteOpen((prev) => !prev);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", shortcut.reset);
    window.addEventListener("compositionstart", shortcut.reset);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", shortcut.reset);
      window.removeEventListener("compositionstart", shortcut.reset);
    };
  }, [commandPaletteShortcutEnabled]);

  // Ctrl+Shift+E toggles between the two most recent sidebar panels.
  const previousRailViewRef = useRef<RailView | null>(null);
  const currentRailViewRef = useRef(railView);
  useEffect(() => {
    if (currentRailViewRef.current !== railView) {
      previousRailViewRef.current = currentRailViewRef.current;
      currentRailViewRef.current = railView;
    }
  }, [railView]);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.code !== "KeyE") return;
      e.preventDefault();
      const previous = previousRailViewRef.current;
      if (!sidebarOpen) {
        setSidebarOpen(true);
        return;
      }
      if (previous && previous !== railView) handleRailClick(previous);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [railView, sidebarOpen]);

  // Split-screen and tab navigation hotkeys
  // Also registered in globalShortcutHandler so xterm can invoke directly
  // without going through synthetic DOM events (which are unreliable).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        if (e.code === "KeyF") {
          e.preventDefault();
          toggleAppFullscreen();
          return;
        }
      }

      // Ctrl+Shift+\ splits right, Ctrl+Shift+- splits down, Ctrl+Shift+Enter
      // zooms the focused pane.
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        if (e.code === "Backslash" || e.code === "Minus") {
          e.preventDefault();
          splitActionsRef.current?.splitActive(
            e.code === "Backslash" ? "right" : "bottom",
          );
          return;
        }
        if (e.code === "Enter" && splitActionsRef.current?.zoomFocused()) {
          e.preventDefault();
          return;
        }
      }

      // Alt+Arrow moves between panes of the active split
      if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        const direction = (
          {
            ArrowLeft: "left",
            ArrowRight: "right",
            ArrowUp: "up",
            ArrowDown: "down",
          } as Record<string, NavDirection>
        )[e.code];
        if (direction && splitActionsRef.current?.navigate(direction)) {
          e.preventDefault();
          return;
        }
      }

      // Cmd+1..9 on macOS, Alt+1..9 elsewhere: jump directly to the tab at that position
      const tabDigit = getTabJumpDigit(e);
      if (tabDigit !== null) {
        const currentTabs = tabsRef.current.filter(
          (tab) => !tab.parentSplitTabId,
        );
        const index = tabDigit - 1;
        if (index < currentTabs.length) {
          e.preventDefault();
          setActiveTabId(currentTabs[index].id);
        }
        return;
      }

      // Ctrl+Shift+] / Ctrl+Shift+[: cycle through open tabs (] = next, [ = previous)
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        if (e.code === "BracketRight" || e.code === "BracketLeft") {
          e.preventDefault();
          const currentTabs = tabsRef.current.filter(
            (tab) => !tab.parentSplitTabId,
          );
          if (currentTabs.length < 2) return;
          const currentId = activeTabIdRef.current;
          const idx = currentTabs.findIndex((t) => t.id === currentId);
          const next =
            e.code === "BracketRight"
              ? (idx + 1) % currentTabs.length
              : (idx - 1 + currentTabs.length) % currentTabs.length;
          setActiveTabId(currentTabs[next].id);
          return;
        }
      }
    };

    globalShortcutHandler.current = handleKeyDown;
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      globalShortcutHandler.current = null;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      const v = localStorage.getItem("commandPaletteShortcutEnabled");
      setCommandPaletteShortcutEnabled(v !== null ? v === "true" : true);
    };
    window.addEventListener("commandPaletteShortcutEnabledChanged", handler);
    return () =>
      window.removeEventListener(
        "commandPaletteShortcutEnabledChanged",
        handler,
      );
  }, []);

  useEffect(() => {
    const handler = () => {
      setShowTabNumbers(localStorage.getItem("showTabNumbers") === "true");
    };
    window.addEventListener("showTabNumbersChanged", handler);
    return () => window.removeEventListener("showTabNumbersChanged", handler);
  }, []);

  useEffect(() => {
    const handle = (event: Event) => {
      const manual =
        event instanceof CustomEvent &&
        (event.detail as { manual?: boolean } | undefined)?.manual === true;
      // Drop the cached grants so the next user never inherits them.
      resetPermissionsCache();
      onLogout(manual ? { manual: true } : undefined);
    };
    window.addEventListener("termix:logout", handle);
    return () => window.removeEventListener("termix:logout", handle);
  }, [onLogout]);

  useEffect(() => {
    const handleSessionExpired = () => onLogout();
    dbHealthMonitor.on("session-expired", handleSessionExpired);
    return () => dbHealthMonitor.off("session-expired", handleSessionExpired);
  }, [onLogout]);

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

  useEffect(() => {
    const handleDegraded = () => {
      toast.loading(t("common.connectionDegraded"), {
        id: "db-connection-degraded",
        duration: Infinity,
        dismissible: false,
        action: {
          label: t("common.reload"),
          onClick: () => window.location.reload(),
        },
      });
    };

    const handleRestored = () => {
      toast.dismiss("db-connection-degraded");
      toast.success(t("common.backendReconnected"), { duration: 3000 });
    };

    dbHealthMonitor.on("database-connection-degraded", handleDegraded);
    dbHealthMonitor.on("database-connection-degraded-cleared", handleRestored);

    return () => {
      dbHealthMonitor.off("database-connection-degraded", handleDegraded);
      dbHealthMonitor.off(
        "database-connection-degraded-cleared",
        handleRestored,
      );
    };
  }, [t]);

  useEffect(() => {
    getUserPreferences()
      .then((prefs) => {
        const loginLanguage = consumeLoginLanguage();
        setUserPrefs(prefs);
        if (prefs.storageMode === "cloud") {
          // Persist the current browser values before overwriting, so any tab can restore them
          if (!localStorage.getItem("termix-local-snapshot")) {
            const SNAPSHOT_KEYS = [
              "termix-accent",
              "termix-font-size",
              "termix-ui-font",
              "i18nextLng",
              "commandPaletteShortcutEnabled",
              "showHostTags",
              "hostTrayOnClick",
              "pinAppRail",
              "expandAppRailOnHover",
              "disableUpdateCheck",
              "confirmTabClose",
              "hiddenRailTabs",
            ];
            const snap: Record<string, string | null> = {
              __theme: localStorage.getItem("termix-theme"),
            };
            for (const key of SNAPSHOT_KEYS)
              snap[key] = localStorage.getItem(key);
            localStorage.setItem("termix-local-snapshot", JSON.stringify(snap));
          }
          if (prefs.theme) setTheme(prefs.theme as ThemeId);
          if (prefs.fontSize) applyFontSize(prefs.fontSize as FontSizeId);
          if (prefs.accentColor) {
            localStorage.setItem("termix-accent", prefs.accentColor);
            applyAccentColor(prefs.accentColor);
          }
          const preferredLanguage = loginLanguage ?? prefs.language;
          if (preferredLanguage && preferredLanguage !== i18n.language) {
            void changeAppLanguage(preferredLanguage);
          }
          if (loginLanguage && loginLanguage !== prefs.language) {
            void saveUserPreferences({ language: loginLanguage });
          }
          if (
            prefs.commandPaletteEnabled !== null &&
            prefs.commandPaletteEnabled !== undefined
          )
            localStorage.setItem(
              "commandPaletteShortcutEnabled",
              String(prefs.commandPaletteEnabled),
            );
          if (prefs.showHostTags !== null && prefs.showHostTags !== undefined) {
            localStorage.setItem("showHostTags", String(prefs.showHostTags));
            window.dispatchEvent(new CustomEvent("showHostTagsChanged"));
          }
          if (
            prefs.hostTrayOnClick !== null &&
            prefs.hostTrayOnClick !== undefined
          )
            localStorage.setItem(
              "hostTrayOnClick",
              String(prefs.hostTrayOnClick),
            );
          if (prefs.pinAppRail !== null && prefs.pinAppRail !== undefined) {
            localStorage.setItem("pinAppRail", String(prefs.pinAppRail));
            window.dispatchEvent(new Event("pinAppRailChanged"));
          }
          if (
            prefs.expandAppRailOnHover !== null &&
            prefs.expandAppRailOnHover !== undefined
          ) {
            localStorage.setItem(
              "expandAppRailOnHover",
              String(prefs.expandAppRailOnHover),
            );
            window.dispatchEvent(new Event("expandAppRailOnHoverChanged"));
          }
          if (
            prefs.disableUpdateCheck !== null &&
            prefs.disableUpdateCheck !== undefined
          )
            localStorage.setItem(
              "disableUpdateCheck",
              String(prefs.disableUpdateCheck),
            );
          if (
            prefs.confirmTabClose !== null &&
            prefs.confirmTabClose !== undefined
          )
            localStorage.setItem(
              "confirmTabClose",
              String(prefs.confirmTabClose),
            );
          if (
            prefs.hiddenRailTabs !== null &&
            prefs.hiddenRailTabs !== undefined
          ) {
            localStorage.setItem("hiddenRailTabs", prefs.hiddenRailTabs);
            window.dispatchEvent(new CustomEvent("hiddenRailTabsChanged"));
          }
        }
      })
      .catch(() => {})
      .finally(() => setUserPrefsLoaded(true));
  }, []);

  // Load real hosts from API
  const loadHosts = useCallback(async () => {
    try {
      const [raw, folders] = await Promise.all([
        getSSHHosts(),
        getSSHFolders().catch(() => []),
      ]);
      const converted = raw.map(sshHostToHost);
      setAllHosts(converted);
      const folderMeta = new Map<
        string,
        {
          color?: string;
          icon?: string;
          credentialId?: number | null;
          sortOrder?: number | null;
          localOnly?: boolean;
        }
      >();
      for (const f of folders) {
        folderMeta.set(f.name, {
          color: f.color ?? undefined,
          icon: f.icon ?? undefined,
          credentialId: f.credentialId ?? null,
          sortOrder: f.sortOrder ?? null,
          localOnly: !!f.localOnly,
        });
      }
      setRealHostTree(buildHostTree(raw, folderMeta));
    } catch {
      // Keep empty state on error
    } finally {
      setHostsLoading(false);
      setHostsLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadHosts();
  }, [loadHosts]);

  useEffect(() => {
    const onHostsChanged = () => {
      void loadHosts();
    };
    window.addEventListener("termix:hosts-changed", onHostsChanged);
    window.addEventListener("ssh-hosts:changed", onHostsChanged);
    window.addEventListener("hosts:refresh", onHostsChanged);
    return () => {
      window.removeEventListener("termix:hosts-changed", onHostsChanged);
      window.removeEventListener("ssh-hosts:changed", onHostsChanged);
      window.removeEventListener("hosts:refresh", onHostsChanged);
    };
  }, [loadHosts]);

  // Keeps the desktop's sync status polled while the app is open; a pass
  // that changed data tells the panels to reload.
  useSyncStatus();

  // Sync tab host data when allHosts updates (e.g. after editing terminal theme in host settings)
  useEffect(() => {
    if (allHosts.length === 0) return;
    const byId = new Map(allHosts.map((h) => [h.id, h]));
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
  }, [allHosts]);

  function buildWorkspacePayload(): WorkspacePayload {
    return buildLayoutPayload({
      tabs,
      activeTabId,
      sidebar: {
        left: { view: railView, open: sidebarOpen, width: sidebarWidth },
        right: {
          view: rightRailView,
          open: rightRailView !== null,
          width: rightSidebarWidth,
        },
      },
    });
  }

  async function applyLayout(
    payload: WorkspacePayload,
    name: string,
  ): Promise<{ skipped: string[] }> {
    // Tear down the current arrangement the same way an individual tab close does.
    for (const tab of [...tabsRef.current]) {
      doCloseTab(tab.id);
    }
    // Tabs reopened here must not be pulled into a pane of the old layout.
    suppressPaneTargetRef.current = true;
    pendingPaneTargetRef.current = null;
    try {
      const slotIdToNewTabId = new Map<string, string>();
      const skippedTabs: string[] = [];

      for (const snapshot of payload.tabs) {
        const target = resolveLayoutTabTarget(snapshot, allHostsRef.current);

        if (target.kind === "skip") {
          skippedTabs.push(snapshot.hostNameSnapshot || snapshot.label);
          continue;
        }

        if (target.kind === "singleton") {
          const newTabId = openSingletonTab(
            snapshot.type,
            undefined,
            target.host,
            snapshotData(snapshot),
          );
          slotIdToNewTabId.set(snapshot.slotId, newTabId ?? snapshot.type);
          continue;
        }

        if (target.kind === "host") {
          const newTabId = openTab(
            target.host,
            snapshot.type,
            {
              instanceId: createId(),
              restoredSessionId: null,
              savedLabel: snapshot.customLabel ?? snapshot.label,
            },
            { data: snapshotData(snapshot) },
          );
          slotIdToNewTabId.set(snapshot.slotId, newTabId);
        }
      }

      const splitIdBySlotId = new Map<string, string>();
      const splitIdByTabId = new Map<string, string>();
      let firstSplitId: string | null = null;
      resolveLayoutSplits(payload, slotIdToNewTabId).forEach((saved, index) => {
        const splitTab = makeSplitTab(
          createId(),
          saved.label || name || splitLabel(index + 1),
          saved.split,
        );
        if (saved.slotId) splitIdBySlotId.set(saved.slotId, splitTab.id);
        for (const pane of listPanes(saved.split.root)) {
          if (pane.tabId) splitIdByTabId.set(pane.tabId, splitTab.id);
        }
        firstSplitId ??= splitTab.id;
        setTabs((prev) => addSplitTab(prev, splitTab));
      });

      // A tab that now sits in a split is shown through its split.
      const activeSlot = payload.activeSlotId;
      const activeTabInLayout = activeSlot
        ? slotIdToNewTabId.get(activeSlot)
        : undefined;
      const activeId =
        (activeSlot ? splitIdBySlotId.get(activeSlot) : undefined) ??
        (activeTabInLayout
          ? (splitIdByTabId.get(activeTabInLayout) ?? activeTabInLayout)
          : undefined) ??
        firstSplitId ??
        "dashboard";
      setActiveTabId(activeId);

      // Older payloads predate the sidebar field, so leave the docks alone then.
      const sidebar = payload.sidebar;
      if (sidebar) {
        if (sidebar.left.view) {
          setRailView(
            (sidebar.left.view === "split-screen"
              ? "hosts"
              : sidebar.left.view) as RailView,
          );
        }
        setSidebarOpen(sidebar.left.open);
        if (sidebar.left.width) setSidebarWidth(sidebar.left.width);

        const right = sidebar.right.open ? sidebar.right.view : null;
        setRightRailView(
          right && rightDockableIds().includes(right)
            ? (right as RailView)
            : null,
        );
        if (sidebar.right.width) setRightSidebarWidth(sidebar.right.width);
      }

      return { skipped: skippedTabs };
    } finally {
      suppressPaneTargetRef.current = false;
    }
  }

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
                ? allHosts.find((h) => h.id === String(saved.hostId))
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
  }, [
    tabs,
    tabsReady,
    railView,
    sidebarOpen,
    sidebarWidth,
    rightRailView,
    rightSidebarWidth,
  ]);

  // ─── Tab management ──────────────────────────────────────────────────────

  const openTab = useCallback(function openTab(
    host: Host,
    type: TabType,
    restore?: {
      instanceId: string;
      restoredSessionId: string | null;
      savedLabel?: string;
    },
    options?: {
      data?: Record<string, unknown>;
      label?: string;
      forceNewTab?: boolean;
    },
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
    options?: {
      data?: Record<string, unknown>;
      label?: string;
      forceNewTab?: boolean;
    },
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
        await loadHosts();
        toast.success(t("hosts.hostCreated"));
      } catch (error) {
        toast.error(t("hosts.failedToSave"));
        throw error;
      }
    },
    [loadHosts, t],
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
      unsplit(id);
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
      if (next.length === 0)
        return [
          {
            id: "dashboard",
            instanceId: "dashboard",
            type: "dashboard",
            label: t("nav.dashboard"),
            openedAt: Date.now(),
          },
        ];
      return next;
    });
  }

  const reconnectAllRef = useRef<() => void>(() => {});
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
      const ask = shellConfirmRef.current;
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
      else closePaneOf(active.id, active.split.focusedPaneId);
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

  // ─── Split screen ────────────────────────────────────────────────────────

  const splitLabel = (number: number) =>
    t("splitScreen.defaultLabel", { number });

  /**
   * Edits a split with a change computed from the last committed state, for
   * edits that create panes and so have to know the new pane's id.
   */
  function commitSplit(
    splitTabId: string,
    fn: (state: SplitState) => SplitState | null,
  ): SplitState | null {
    const current = tabsRef.current.find((tab) => tab.id === splitTabId);
    if (!isSplitTab(current)) return null;
    const next = fn(current.split);
    setTabs((prev) =>
      updateSplit(prev, splitTabId, (state) =>
        state === current.split ? next : fn(state),
      ),
    );
    return next;
  }

  function editSplit(
    splitTabId: string,
    fn: (state: SplitState) => SplitState | null,
  ) {
    setTabs((prev) => updateSplit(prev, splitTabId, fn));
  }

  function warnSplitFull() {
    toast.error(t("splitScreen.maxPanes", { count: MAX_PANES }));
  }

  function openSplitTab(state: SplitState): SplitTab {
    const number = nextSplitNumber(tabsRef.current, splitLabel);
    const splitTab = makeSplitTab(createId(), splitLabel(number), state);
    setTabs((prev) => addSplitTab(prev, splitTab));
    setActiveTabId(splitTab.id);
    return splitTab;
  }

  /** A new split of `tabId` (or of an empty pane) with a fresh pane at `edge`. */
  function startSplit(tabId: string | null, edge: PaneEdge): SplitTab {
    const own = createPane(tabId);
    const fresh = createPane();
    const leading = edge === "left" || edge === "top";
    const root = createSplitNode(
      edge === "left" || edge === "right" ? "row" : "column",
      leading ? [fresh, own] : [own, fresh],
    );
    return openSplitTab(createSplitState(root, fresh.id));
  }

  function splitPaneOf(splitTabId: string, paneId: string, edge: PaneEdge) {
    commitSplit(splitTabId, (state) => {
      const result = splitPane(state, paneId, edge);
      if (!result) warnSplitFull();
      return result ? result.state : state;
    });
    setActiveTabId(splitTabId);
  }

  /**
   * Splits a tab: a split grows at its focused pane, a tab inside a split
   * grows at its own pane, anything else becomes a new split.
   */
  function splitTabAt(tabId: string, edge: PaneEdge) {
    const current = tabsRef.current;
    const tab = current.find((t) => t.id === tabId);
    if (!tab) return;
    if (isSplitTab(tab)) {
      splitPaneOf(tab.id, tab.split.focusedPaneId, edge);
      return;
    }
    const parent = splitTabOf(current, tabId);
    const pane = parent ? findPaneByTab(parent.split, tabId) : undefined;
    if (parent && pane) {
      splitPaneOf(parent.id, pane.id, edge);
      return;
    }
    startSplit(canJoinSplit(tab) ? tab.id : null, edge);
  }

  function applyLayoutPreset(presetId: SplitPresetId) {
    const active = tabsRef.current.find(
      (tab) => tab.id === activeTabIdRef.current,
    );
    if (isSplitTab(active)) {
      commitSplit(active.id, (state) => applyPreset(state, presetId));
      return;
    }
    const root = buildPreset(
      presetId,
      active && canJoinSplit(active) ? [active.id] : [],
    );
    openSplitTab(createSplitState(root));
  }

  /** Closes a split tab, sending its tabs back to the tab bar. */
  function unsplit(splitTabId: string) {
    const split = tabsRef.current.find((tab) => tab.id === splitTabId);
    if (!isSplitTab(split)) return;
    const focusedTabId =
      findPane(split.split, split.split.focusedPaneId)?.tabId ??
      listPanes(split.split.root).find((pane) => pane.tabId)?.tabId ??
      null;
    setTabs((prev) => closeSplitTab(prev, splitTabId));
    if (activeTabIdRef.current === splitTabId) {
      const fallback = tabsRef.current.filter(
        (tab) => tab.id !== splitTabId && !tab.parentSplitTabId,
      );
      setActiveTabId(
        focusedTabId ?? fallback[fallback.length - 1]?.id ?? "dashboard",
      );
    }
  }

  /** Removes a pane; its tab, if any, goes back to the tab bar. */
  function closePaneOf(splitTabId: string, paneId: string) {
    const split = tabsRef.current.find((tab) => tab.id === splitTabId);
    if (!isSplitTab(split)) return;
    if (listPanes(split.split.root).length <= 1) {
      unsplit(splitTabId);
      return;
    }
    editSplit(splitTabId, (state) => removePane(state, paneId));
  }

  function handleTabSplitAction(action: TabSplitAction) {
    switch (action.kind) {
      case "split":
        splitTabAt(action.tabId, action.edge);
        break;
      case "splitActive":
        splitTabAt(activeTabIdRef.current, action.edge);
        break;
      case "preset":
        applyLayoutPreset(action.presetId);
        break;
      case "unsplit":
        unsplit(action.splitTabId);
        break;
      case "addToPane":
        setTabs((prev) =>
          placeTabInPane(prev, action.splitTabId, action.paneId, action.tabId),
        );
        setActiveTabId(action.splitTabId);
        break;
      case "addPane":
        commitSplit(action.splitTabId, (state) => {
          const result = addPaneAtEdge(state, action.edge, action.tabId);
          if (!result) warnSplitFull();
          return result ? result.state : state;
        });
        setActiveTabId(action.splitTabId);
        break;
    }
  }

  /** "Open in split" from the host list: aim the next tab, then open it. */
  const splitOpenerRef = useRef<
    (target: SplitOpenTarget, open: () => void) => void
  >(() => {});
  splitOpenerRef.current = (target, open) => {
    if (target.kind === "pane") {
      targetPane(target.splitTabId, target.paneId);
    } else if (target.kind === "newPane") {
      const split = tabsRef.current.find((tab) => tab.id === target.splitTabId);
      if (!isSplitTab(split)) return;
      const result = addPaneAtEdge(split.split, "right");
      if (!result) {
        warnSplitFull();
        return;
      }
      editSplit(split.id, (state) =>
        state === split.split ? result.state : state,
      );
      setActiveTabId(split.id);
      targetPane(split.id, result.paneId, true);
    } else {
      const active = tabsRef.current.find(
        (tab) => tab.id === activeTabIdRef.current,
      );
      if (!active || !canJoinSplit(active)) return;
      const splitTab = startSplit(active.id, "right");
      targetPane(splitTab.id, splitTab.split.focusedPaneId, true);
    }
    open();
  };

  /** A tab or pane dropped on the main area. */
  const splitDropRef = useRef<
    (source: SplitDragSource, hover: SplitDropHover) => void
  >(() => {});
  splitDropRef.current = (source, hover) => {
    if (source.kind === "pane") {
      const toPaneId = hover.paneId;
      if (!toPaneId) return;
      editSplit(source.splitTabId, (state) =>
        movePane(state, source.paneId, toPaneId, hover.target),
      );
      return;
    }
    const active = tabsRef.current.find(
      (tab) => tab.id === activeTabIdRef.current,
    );
    if (hover.paneId === null) {
      if (hover.target === "center") return;
      const other =
        active && canJoinSplit(active) && active.id !== source.tabId
          ? active.id
          : null;
      const dragged = createPane(source.tabId);
      const rest = createPane(other);
      const leading = hover.target === "left" || hover.target === "top";
      const root = createSplitNode(
        hover.target === "left" || hover.target === "right" ? "row" : "column",
        leading ? [dragged, rest] : [rest, dragged],
      );
      openSplitTab(createSplitState(root, dragged.id));
      return;
    }
    if (!isSplitTab(active)) return;
    const paneId = hover.paneId;
    if (hover.target === "center") {
      setTabs((prev) => placeTabInPane(prev, active.id, paneId, source.tabId));
      return;
    }
    const edge = hover.target;
    commitSplit(active.id, (state) => {
      const result = splitPane(state, paneId, edge, source.tabId);
      if (!result) warnSplitFull();
      return result ? result.state : state;
    });
  };

  splitActionsRef.current = {
    splitActive: (edge) => splitTabAt(activeTabIdRef.current, edge),
    navigate: (direction) => {
      const active = tabsRef.current.find(
        (tab) => tab.id === activeTabIdRef.current,
      );
      if (!isSplitTab(active)) return false;
      const view = document.querySelector(`[data-split-view="${active.id}"]`);
      if (!view) return false;
      const rects: Record<string, PaneRect> = {};
      view
        .querySelectorAll<HTMLElement>("[data-split-pane-id]")
        .forEach((el) => {
          const id = el.dataset.splitPaneId;
          if (id) rects[id] = el.getBoundingClientRect();
        });
      const next = neighborPane(active.split.focusedPaneId, direction, rects);
      if (next) editSplit(active.id, (state) => focusPane(state, next));
      return true;
    },
    zoomFocused: () => {
      const active = tabsRef.current.find(
        (tab) => tab.id === activeTabIdRef.current,
      );
      if (!isSplitTab(active) || listPanes(active.split.root).length < 2) {
        return false;
      }
      editSplit(active.id, (state) => toggleZoom(state, state.focusedPaneId));
      return true;
    },
    closeFocusedPane: () => {
      const active = tabsRef.current.find(
        (tab) => tab.id === activeTabIdRef.current,
      );
      if (isSplitTab(active)) {
        closePaneOf(active.id, active.split.focusedPaneId);
      }
    },
  };

  useEffect(() => {
    const disposeOpener = setSplitOpener((target, open) =>
      splitOpenerRef.current(target, open),
    );
    const disposeDrop = setSplitDropHandler((source, hover) =>
      splitDropRef.current(source, hover),
    );
    const activeIsSplit = () =>
      isSplitTab(
        tabsRef.current.find((tab) => tab.id === activeTabIdRef.current),
      );
    const entries = [
      registerPaletteEntry({
        id: "core.reconnectDisconnected",
        titleKey: "nav.reconnectDisconnectedTerminals",
        icon: RotateCcw,
        keywords: ["reconnect", "disconnected", "ssh", "all", "network"],
        scope: "global",
        run: () => reconnectAllRef.current(),
      }),
      registerPaletteEntry({
        id: "core.split.right",
        titleKey: "splitScreen.splitRight",
        icon: Columns2,
        keywords: ["split", "pane"],
        scope: "global",
        run: () => splitActionsRef.current?.splitActive("right"),
      }),
      registerPaletteEntry({
        id: "core.split.down",
        titleKey: "splitScreen.splitDown",
        icon: Rows2,
        keywords: ["split", "pane"],
        scope: "global",
        run: () => splitActionsRef.current?.splitActive("bottom"),
      }),
      registerPaletteEntry({
        id: "core.split.zoom",
        titleKey: "splitScreen.zoom",
        icon: Maximize2,
        keywords: ["split", "pane"],
        scope: "global",
        when: activeIsSplit,
        run: () => void splitActionsRef.current?.zoomFocused(),
      }),
      registerPaletteEntry({
        id: "core.split.closePane",
        titleKey: "splitScreen.closePane",
        icon: X,
        keywords: ["split", "pane"],
        scope: "global",
        when: activeIsSplit,
        run: () => splitActionsRef.current?.closeFocusedPane(),
      }),
    ];
    return () => {
      disposeOpener();
      disposeDrop();
      for (const dispose of entries) dispose();
    };
  }, []);

  // ─── Rail / sidebar ──────────────────────────────────────────────────────

  // Moving a panel to the right dock rather than copying it: two live copies of
  // the same panel would fight over the shared editing state.
  function openInRightDock(view: RailView) {
    setRightRailView(view);
    if (railView === view) setSidebarOpen(false);
  }

  // Tab bar toggle: reopens whatever was last in the dock, so it behaves like a
  // show/hide rather than losing the user's choice each time.
  function toggleRightDock() {
    if (rightRailView) {
      lastRightRailViewRef.current = rightRailView;
      setRightRailView(null);
      return;
    }
    const fallback = lastRightRailViewRef.current ?? rightDockableIds()[0];
    if (fallback) setRightRailView(fallback as RailView);
  }

  function handleRailClick(view: RailView) {
    if (railView === view && sidebarOpen) {
      setSidebarOpen(false);
    } else {
      // A panel lives in one dock at a time, so the left dock reclaims it.
      if (rightRailView === view) setRightRailView(null);
      setRailView(view);
      setSidebarOpen(true);
    }
  }

  function editHostInManager(host: Host) {
    requestManage({ kind: "host", hostId: host.id });
    if (isMobile) setSidebarOpen(false);
  }

  const onSidebarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setSidebarDragging(true);
      const startX = e.clientX;
      const startW = sidebarWidth;
      // Widths are kept in Normal-size pixels, so a drag is scaled back.
      const scale = remScale();
      // One width update per frame, not per mousemove.
      let frame = 0;
      let clientX = startX;
      function onMove(ev: MouseEvent) {
        clientX = ev.clientX;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          setSidebarWidth(
            Math.max(160, Math.min(480, startW + (clientX - startX) / scale)),
          );
        });
      }
      function onUp() {
        cancelAnimationFrame(frame);
        setSidebarWidth(
          Math.max(160, Math.min(480, startW + (clientX - startX) / scale)),
        );
        setSidebarDragging(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth],
  );

  // Same drag, mirrored: the right dock grows as the pointer moves left.
  const onRightSidebarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setRightSidebarDragging(true);
      const startX = e.clientX;
      const startW = rightSidebarWidth;
      const scale = remScale();
      let frame = 0;
      let clientX = startX;
      function onMove(ev: MouseEvent) {
        clientX = ev.clientX;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          setRightSidebarWidth(
            Math.max(160, Math.min(480, startW - (clientX - startX) / scale)),
          );
        });
      }
      function onUp() {
        cancelAnimationFrame(frame);
        setRightSidebarWidth(
          Math.max(160, Math.min(480, startW - (clientX - startX) / scale)),
        );
        setRightSidebarDragging(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [rightSidebarWidth],
  );

  // Resize all terminals in panes + active terminal when split mode or sidebar changes
  const resizeAllTerminals = useCallback(() => {
    const id = requestAnimationFrame(() => {
      tabs.forEach((tab) => {
        if (!tab.terminalRef) return;
        const ref = tab.terminalRef.current;
        ref?.fit?.();
        ref?.notifyResize?.();
      });
    });
    return id;
  }, [tabs]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeSplit = isSplitTab(activeTab) ? activeTab : null;
  // The pane each on-screen tab sits in, for the active split only.
  const paneIdByTabId = new Map<string, string>();
  if (activeSplit) {
    for (const pane of shownPanes(activeSplit.split, isMobile)) {
      if (pane.tabId) paneIdByTabId.set(pane.tabId, pane.id);
    }
  }
  // Changes when panes appear, move or change tab, but not on a divider drag,
  // which fits the terminals itself once it ends.
  const splitShapeKey = activeSplit
    ? `${activeSplit.id}|${activeSplit.split.zoomedPaneId ?? ""}|${[
        ...paneIdByTabId.entries(),
      ].join(",")}|${listPanes(activeSplit.split.root).length}`
    : "";

  useEffect(() => {
    // Refitting every terminal on each drag frame is what made sidebar drags
    // stutter; fit once when the drag ends instead.
    if (sidebarDragging || rightSidebarDragging) return;
    const id = resizeAllTerminals();
    return () => cancelAnimationFrame(id);
  }, [
    splitShapeKey,
    sidebarWidth,
    sidebarOpen,
    rightSidebarWidth,
    rightRailView,
    sidebarDragging,
    rightSidebarDragging,
  ]);

  // A tab inside a split is never shown on its own: activating one (tab jump,
  // the connections panel, an existing session) shows its split instead,
  // focused on its pane. Also falls back when the active tab is gone.
  useLayoutEffect(() => {
    if (!activeTab) {
      if (!tabsReady) return;
      const topLevel = tabs.filter((tab) => !tab.parentSplitTabId);
      setActiveTabId(topLevel[topLevel.length - 1]?.id ?? "dashboard");
      return;
    }
    if (!activeTab.parentSplitTabId) return;
    const parent = splitTabOf(tabs, activeTab.id);
    if (!parent) return;
    const childId = activeTab.id;
    setTabs((prev) =>
      updateSplit(prev, parent.id, (state) => {
        const pane = findPaneByTab(state, childId);
        return pane ? focusPane(state, pane.id) : state;
      }),
    );
    setActiveTabId(parent.id);
  }, [activeTab, tabs, tabsReady]);

  // Moving focus to a pane moves keyboard focus into its session, unless the
  // user is in a menu or already typing in that pane.
  const focusedPaneId = activeSplit?.split.focusedPaneId ?? null;
  const focusedPaneTabId = focusedPaneId
    ? (findPane(activeSplit!.split, focusedPaneId)?.tabId ?? null)
    : null;
  useEffect(() => {
    if (!focusedPaneId || !focusedPaneTabId) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const focused = document.activeElement as HTMLElement | null;
      const paneEl = paneElsRef.current.get(focusedPaneId);
      if (focused && paneEl?.contains(focused)) return;
      if (
        focused?.closest?.(
          '[data-split-pane-header], [role="menu"], [role="dialog"]',
        )
      ) {
        return;
      }
      const tab = tabsRef.current.find((t) => t.id === focusedPaneTabId);
      const handle = tab?.terminalRef?.current as TabHandle | null | undefined;
      if (handle?.focus) {
        handle.focus();
        return;
      }
      // A session opened into the pane a moment ago may not have mounted yet.
      if (attempts++ < 10) timer = setTimeout(attempt, 100);
    };
    const frame = requestAnimationFrame(attempt);
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, [focusedPaneId, focusedPaneTabId]);

  useEffect(() => {
    publishSplitTargets({
      splits: summarizeSplits(tabs, MAX_PANES),
      canStartSplit: canJoinSplit(activeTab) && !activeTab?.parentSplitTabId,
    });
  }, [tabs, activeTab]);

  // Move each tab's stable DOM node to the right container (pane or normal-view).
  // This is vanilla DOM so React's portal target never changes. Changing the portal
  // target causes a remount which is exactly what we're trying to avoid.
  // useLayoutEffect (not useEffect) so visibility/display are corrected before
  // the browser paints, otherwise the previous tab's node can flash on screen
  // for a frame while still visible.
  useLayoutEffect(() => {
    const normalView = normalViewRef.current;
    if (!normalView) return;

    const tabIds = new Set(tabs.map((t) => t.id));

    // Remove nodes for closed tabs
    for (const [id, node] of tabNodesRef.current) {
      if (!tabIds.has(id)) {
        node.remove();
        tabNodesRef.current.delete(id);
      }
    }

    for (const tab of tabs) {
      const isTerminal = !!getTabType(tab.type)?.ownBackground;
      const node = getTabNode(tab.id, isTerminal);
      const paneId = paneIdByTabId.get(tab.id);
      const paneEl = paneId ? paneElsRef.current.get(paneId) : undefined;
      const inPane = !!paneId;
      const activeInline = !inPane && tab.id === activeTabId;

      if (inPane && paneEl) {
        if (node.parentElement !== paneEl) paneEl.appendChild(node);
        node.style.visibility = "visible";
        node.style.pointerEvents = "auto";
        node.style.display = "";
        node.style.zIndex = "";
        node.style.contentVisibility = "";
      } else {
        if (node.parentElement !== normalView) normalView.appendChild(node);
        if (isTerminal) {
          node.style.display = "";
          node.style.visibility = activeInline ? "visible" : "hidden";
          node.style.pointerEvents = activeInline ? "auto" : "none";
          node.style.zIndex = activeInline ? "1" : "0";
          // xterm renders to a <canvas>; visibility:hidden alone can still let
          // a stale composited frame flash through for a tick when switching
          // to/from a non-terminal tab. content-visibility:hidden fully skips
          // painting the subtree while keeping its layout box intact, so
          // fitAddon.fit() still sees correct dimensions once it's shown again.
          node.style.contentVisibility = activeInline ? "" : "hidden";
        } else {
          // Plays a quick opacity fade-in on the tab that just became active.
          // Only play it on an actual switch into this tab -- gating on the
          // class alone replayed the animation on every unrelated re-render
          // that happened while the tab was still active (any render after
          // animationend had stripped the class), which looked like the
          // panel kept growing for up to a second after switching.
          if (activeInline && lastAnimatedTabIdRef.current !== tab.id) {
            lastAnimatedTabIdRef.current = tab.id;
            node.classList.remove("motion-workspace-enter");
            // Force a reflow so re-adding the class restarts the animation
            // instead of no-oping because it was already removed this tick.
            void node.offsetWidth;
            node.classList.add("motion-workspace-enter");
            node.addEventListener(
              "animationend",
              () => node.classList.remove("motion-workspace-enter"),
              { once: true },
            );
          } else if (!activeInline) {
            node.classList.remove("motion-workspace-enter");
            if (lastAnimatedTabIdRef.current === tab.id) {
              lastAnimatedTabIdRef.current = null;
            }
          }
          node.style.visibility = "";
          node.style.pointerEvents = "";
          node.style.zIndex = activeInline ? "2" : "";
          node.style.display = activeInline ? "" : "none";
        }
      }
    }
  });

  const terminalTabs = tabs.filter((t) => getTabType(t.type)?.commandTarget);
  const topLevelTabs = tabs.filter((tab) => !tab.parentSplitTabId);

  function reorderTopLevelTabs(reordered: Tab[]) {
    setTabs((prev) => [
      ...reordered,
      ...prev.filter((tab) => tab.parentSplitTabId),
    ]);
  }

  // What command-target panels act on. Falls back to the remembered
  // terminal when the active tab isn't one, and drops it once it's closed.
  const targetTerminalTabId = terminalTabs.some((t) => t.id === workingTabId)
    ? workingTabId
    : terminalTabs.some((t) => t.id === lastTerminalTabId)
      ? lastTerminalTabId
      : "";

  /**
   * Sidebar panel content, shared between the desktop sidebar, the mobile
   * sheet and the right dock. Takes the view rather than reading railView so
   * both docks can render from the same code.
   *
   * `owned` marks the dock responsible for the panels that stay mounted while
   * hidden (hosts, credentials, fleets). Only one dock may own them, otherwise
   * two live instances fight over the shared editing state.
   */
  // The param deliberately shadows the outer railView so the body reads the
  // same whichever dock is rendering.

  /**
   * What plugins may ask of the shell. Rebuilt every render so it always
   * closes over current state, and published to the plugin runtime.
   */
  const shellCallbacksImpl: TabShellCallbacks = {
    openTab: (host, type, options) => {
      if (!host || getTabType(type)?.singleton) {
        openSingletonTab(
          type,
          undefined,
          host ?? undefined,
          options?.data,
          options?.label,
        );
        return;
      }
      openTab(host, type, undefined, options);
    },
    openSingletonTab: (type, options) =>
      openSingletonTab(type, undefined, undefined, options?.data),
    connectHost: (host, type) => connectHost(host, type as TabType),
    closeTab: (tabId) => closeTab(tabId),
    renameTab: (tabId, label) => renameTab(tabId, label),

    openRailView: (id) => {
      setRailView(id as RailView);
      setSidebarOpen(true);
    },
    closeRailView: (id) => {
      setRailView((prev) => (prev === id ? "hosts" : prev));
      setRightRailView((prev) => (prev === id ? null : prev));
    },
    openHostEditor: (draft) =>
      requestManage({ kind: "host", hostId: null, draft }),
    saveQuickConnect: saveQuickConnectHost,
    confirm: (options) =>
      shellConfirmRef.current
        ? shellConfirmRef.current(options)
        : Promise.resolve(false),
  };

  // Tabs get one stable bag that forwards to the latest callbacks, so a shell
  // render does not re-render every open tab.
  const shellImplRef = useRef(shellCallbacksImpl);
  useLayoutEffect(() => {
    shellImplRef.current = shellCallbacksImpl;
  });
  const shellCallbacks = useMemo<TabShellCallbacks>(
    () => ({
      openTab: (...args) => shellImplRef.current.openTab(...args),
      openSingletonTab: (...args) =>
        shellImplRef.current.openSingletonTab(...args),
      connectHost: (...args) => shellImplRef.current.connectHost(...args),
      closeTab: (...args) => shellImplRef.current.closeTab(...args),
      renameTab: (...args) => shellImplRef.current.renameTab(...args),
      openRailView: (...args) => shellImplRef.current.openRailView(...args),
      closeRailView: (...args) => shellImplRef.current.closeRailView(...args),
      openHostEditor: (...args) =>
        shellImplRef.current.openHostEditor?.(...args),
      saveQuickConnect: (...args) =>
        shellImplRef.current.saveQuickConnect!(...args),
      confirm: (...args) => shellImplRef.current.confirm!(...args),
    }),
    [],
  );

  // Panels close the sidebar on mobile after opening something, the same as
  // the hosts panel does.
  const panelShell = useMemo<TabShellCallbacks>(
    () => ({
      ...shellCallbacks,
      openTab: (...args) => {
        shellCallbacks.openTab(...args);
        if (isMobile) setSidebarOpen(false);
      },
    }),
    [shellCallbacks, isMobile],
  );

  useEffect(() => {
    setShellCallbacks(shellCallbacks);
    setShellLayoutProvider({
      getLayout: () => (tabsReady ? buildWorkspacePayload() : null),
      applyLayout: (layout, options) =>
        applyLayout(layout as WorkspacePayload, options?.name ?? ""),
    });
  });

  useEffect(() => {
    setShellHosts(allHosts, hostsLoaded);
  }, [allHosts, hostsLoaded]);

  // Every panel gets its own surface, so its inline views and confirms stay
  // inside it. Only the left dock widens for them.
  const panelScope = (
    view: string,
    owned: boolean,
    shown: boolean,
    children: React.ReactNode,
    className = "",
  ) => (
    <SurfaceScope
      key={view}
      kind="panel"
      onEditingChange={owned ? scopeEditingSetter(view) : undefined}
      className={`${shown ? "" : "hidden"} ${className}`}
    >
      {children}
    </SurfaceScope>
  );

  const renderSidebarPanels = (railView: RailView, owned = true) => (
    <Suspense fallback={<SidebarPanelFallback />}>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {owned && (
          <>
            {panelScope(
              "hosts",
              owned,
              railView === "hosts",
              <HostsPanel
                onOpenTab={(host, type, options) => {
                  connectHost(host, type, options);
                  if (isMobile) setSidebarOpen(false);
                }}
                onEditHost={editHostInManager}
                hostTree={realHostTree ?? undefined}
                loading={hostsLoading}
                onEditingChange={panelEditingSetter("hosts")}
                active={railView === "hosts"}
              />,
            )}
            {panelScope(
              "credentials",
              owned,
              railView === "credentials",
              <CredentialsPanel
                onEditingChange={panelEditingSetter("credentials")}
                active={railView === "credentials"}
              />,
            )}
          </>
        )}

        {railView === "quick-connect" &&
          panelScope(
            "quick-connect",
            owned,
            true,
            <QuickConnectPanel
              onConnect={(host, type) => {
                openTab(host, type);
                if (isMobile) setSidebarOpen(false);
              }}
            />,
          )}

        {registeredPanels.map((panel) => {
          const shown = railView === panel.id;
          // A kept-mounted panel lives in the owning dock only, so two live
          // copies never fight over the same state.
          if (panel.keepMounted ? !owned : !shown) return null;
          const Panel = panel.component;
          return panelScope(
            panel.id,
            owned,
            shown,
            <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
              <Panel
                targetTab={terminalTabs.find(
                  (tab) => tab.id === targetTerminalTabId,
                )}
                active={shown}
                shell={panelShell}
                setEditing={
                  owned ? panelEditingSetter(panel.id) : () => undefined
                }
                activeTabType={
                  tabs.find((tab) => tab.id === activeTabId)?.type ?? undefined
                }
                placement={owned ? "left" : "right"}
              />
            </div>,
          );
        })}

        {!isCoreRailView(railView) && !getPanel(railView) && (
          <PluginViewPlaceholder kind="panel" viewId={railView} compact />
        )}

        {railView === "connections" &&
          panelScope(
            "connections",
            owned,
            true,
            <div className="flex-1 min-h-0 overflow-y-auto">
              <ConnectionsPanel
                tabs={tabs}
                activeTabId={activeTabId}
                allHosts={allHosts}
                backgroundTabRecords={backgroundTabRecords}
                onSwitchToTab={(tabId) => {
                  setActiveTabId(tabId);
                  if (isMobile) setSidebarOpen(false);
                }}
                onCloseTab={closeTab}
                onReopenTab={(record, restoredSessionId) => {
                  const host = record.hostId
                    ? allHosts.find((h) => h.id === String(record.hostId))
                    : undefined;
                  if (!host && !getTabType(record.tabType)?.hostless) return;
                  setBackgroundTabRecords((prev) =>
                    prev.filter((r) => r.id !== record.id),
                  );
                  if (host) {
                    const effectiveSessionId =
                      restoredSessionId ?? record.backendSessionId ?? null;
                    openTab(host, record.tabType as TabType, {
                      instanceId: record.id,
                      restoredSessionId: effectiveSessionId,
                      savedLabel: record.label,
                    });
                  } else {
                    openSingletonTab(record.tabType as TabType);
                  }
                  if (isMobile) setSidebarOpen(false);
                }}
                onForgetBackground={(recordId) => {
                  setBackgroundTabRecords((prev) =>
                    prev.filter((r) => r.id !== recordId),
                  );
                }}
                onRenameTab={renameTab}
                onReorderTabs={setTabs}
              />
            </div>,
          )}

        {railView === "sync" &&
          panelScope(
            "sync",
            owned,
            true,
            <div className="flex-1 min-h-0 overflow-y-auto">
              <SyncPanel />
            </div>,
          )}
      </div>
    </Suspense>
  );

  function splitViewActions(splitTabId: string): SplitViewActions {
    return {
      focusPane: (paneId) =>
        editSplit(splitTabId, (state) => focusPane(state, paneId)),
      resize: (nodeId, sizes) =>
        editSplit(splitTabId, (state) => resizeSplit(state, nodeId, sizes)),
      equalize: (nodeId) =>
        editSplit(splitTabId, (state) => equalizeSplit(state, nodeId)),
      splitPane: (paneId, edge) => splitPaneOf(splitTabId, paneId, edge),
      closePane: (paneId) => closePaneOf(splitTabId, paneId),
      closeSession: (tabId) => closeTab(tabId),
      moveToTab: (paneId) => closePaneOf(splitTabId, paneId),
      showInPane: (paneId, tabId) => {
        if (tabId) {
          setTabs((prev) => placeTabInPane(prev, splitTabId, paneId, tabId));
        } else {
          editSplit(splitTabId, (state) => assignTab(state, paneId, null));
        }
      },
      swapPanes: (firstId, secondId) =>
        editSplit(splitTabId, (state) => swapPanes(state, firstId, secondId)),
      toggleZoom: (paneId) =>
        editSplit(splitTabId, (state) => toggleZoom(state, paneId)),
      resizeEnd: () => resizeAllTerminals(),
    };
  }

  // Picking a host for a pane always starts a new session, so it never pulls
  // a session out of the tab bar or another split.
  const pickerShell: TabShellCallbacks = {
    ...shellCallbacks,
    openTab: (host, type, options) =>
      shellCallbacks.openTab(host, type, { ...options, forceNewTab: true }),
  };

  function renderEmptyPane(
    splitTabId: string,
    paneId: string,
    paneIndex: number,
  ) {
    return (
      <EmptyPanePicker
        paneIndex={paneIndex}
        freeTabs={tabs.filter(
          (tab) => !tab.parentSplitTabId && canJoinSplit(tab),
        )}
        hosts={allHosts}
        newTabOptions={tabTypes
          .filter((def) => def.multiInstance)
          .map((def) => ({
            type: def.id,
            label: def.titleKey ? t(def.titleKey) : def.id,
            icon: def.icon,
          }))}
        onPickTab={(tabId) =>
          setTabs((prev) => placeTabInPane(prev, splitTabId, paneId, tabId))
        }
        onPickHost={(host, pick: PickHostTarget) => {
          targetPane(splitTabId, paneId);
          if ("item" in pick) {
            const item = pick.action
              .items?.(host)
              .find((candidate) => candidate.id === pick.item.id);
            item?.run(host, pickerShell);
          } else {
            runHostAction(pick.action, host, pickerShell);
          }
        }}
        onOpenType={(type) => {
          targetPane(splitTabId, paneId);
          openMultiInstanceTab(type);
        }}
        onClosePane={() => closePaneOf(splitTabId, paneId)}
      />
    );
  }

  const sidebarPanelContent = renderSidebarPanels(railView);

  const settingsTabProps = {
    username,
    isAdmin: showAdminUI,
    onLogout,
    userPrefs,
    onPrefsChange: (updates: Partial<UserPreferences>) =>
      setUserPrefs((current) => ({ ...current, ...updates })),
    onOpenHostTab: (host: Host) => connectHost(host),
  };

  const leftEditing: EditingWidth = (() => {
    const values = [panelEditing[railView], scopeEditing[railView]];
    if (values.includes("wide")) return "wide";
    return values.some(Boolean);
  })();

  const dockProps = (view: RailView) => ({
    title: sidebarTitle(view),
    onOpenAsTab: isMobile
      ? undefined
      : view === "hosts" || view === "credentials"
        ? () => requestManage({ kind: "browse", mode: view as ManageMode })
        : promotableIds().includes(view)
          ? () => openSingletonTab(view as TabType)
          : undefined,
  });

  return (
    <ServerStatusProvider isAuthenticated={!!username}>
      <div
        className="flex flex-col w-screen bg-background"
        style={{ height: "100dvh" }}
      >
        <div className="flex flex-1 min-h-0">
          {/* Skinny icon rail, desktop only */}
          <AppRail
            railView={railView}
            sidebarOpen={sidebarOpen}
            username={username}
            isAdmin={showAdminUI}
            pluginsSettled={pluginsSettled}
            onRailClick={handleRailClick}
            onOpenTab={openSingletonTab}
            onOpenInRightDock={openInRightDock}
            onOpenSettings={() => openSingletonTab("settings")}
            onOpenNavigationSettings={() =>
              openSingletonTab("settings", undefined, undefined, {
                section: "appearance",
                reveal: "settings-navigation",
                revealAt: Date.now(),
              })
            }
            onOpenPalette={() => setCommandPaletteOpen(true)}
            onLogout={onLogout}
          />

          {/* Desktop: inline resizable sidebar */}
          {!isMobile && (
            <DockPanel
              side="left"
              {...dockProps(railView)}
              open={sidebarOpen}
              width={sidebarWidth}
              editing={leftEditing}
              dragging={sidebarDragging}
              onResizeStart={onSidebarMouseDown}
              onClose={() => setSidebarOpen(false)}
              onMoveToRightDock={
                rightDockableIds().includes(railView)
                  ? () => openInRightDock(railView)
                  : undefined
              }
              onResetWidth={() => setSidebarWidth(DOCK_DEFAULT_WIDTH)}
            >
              {sidebarPanelContent}
            </DockPanel>
          )}

          {/* Mobile: sidebar as overlay sheet */}
          {isMobile && (
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetContent
                side="left"
                showCloseButton={false}
                className={`p-0 flex flex-col min-h-0 max-w-full bg-sidebar border-r border-border gap-0 ${leftEditing ? "w-screen" : "w-[min(85vw,360px)]"}`}
                style={{ height: "100dvh" }}
              >
                <DockPanel
                  side="left"
                  {...dockProps(railView)}
                  open
                  fill
                  width={sidebarWidth}
                  onClose={() => setSidebarOpen(false)}
                >
                  {sidebarPanelContent}
                </DockPanel>
              </SheetContent>
            </Sheet>
          )}

          {/* Main content area */}
          <div
            className={`relative flex flex-col flex-1 min-w-0 overflow-hidden transition-[padding] duration-200 ${!isMobile && !sidebarOpen ? "pl-6" : ""}`}
          >
            {!isMobile && !sidebarOpen && (
              <DockReopenStrip onClick={() => setSidebarOpen(true)} />
            )}
            <SurfaceScope kind="tab" className="overflow-hidden">
              <ShellConfirmCapture confirmRef={shellConfirmRef} />
              <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
                <TabBar
                  tabs={topLevelTabs}
                  activeTabId={activeTabId}
                  splits={summarizeSplits(tabs, MAX_PANES)}
                  activeSplitFull={
                    activeSplit ? !canAddPane(activeSplit.split) : false
                  }
                  onSetActiveTab={setActiveTabId}
                  onCloseTab={closeTab}
                  onRefreshTab={refreshTab}
                  onReconnectDisconnected={reconnectAllDisconnected}
                  onReorderTabs={reorderTopLevelTabs}
                  onSplitAction={handleTabSplitAction}
                  onRenameTab={renameTab}
                  isAppFullscreen={isAppFullscreen}
                  onToggleAppFullscreen={toggleAppFullscreen}
                  rightDockOpen={rightRailView !== null}
                  onToggleRightDock={isMobile ? undefined : toggleRightDock}
                  showTabNumbers={showTabNumbers}
                />
                <div
                  ref={mainAreaRef}
                  className="relative flex flex-col flex-1 min-h-0 overflow-hidden"
                >
                  {activeSplit && (
                    <div className="motion-workspace-layout absolute inset-0 flex flex-col">
                      <SplitView
                        splitTab={activeSplit}
                        tabs={tabs}
                        isMobile={isMobile}
                        actions={splitViewActions(activeSplit.id)}
                        onPaneContentRef={onPaneContentRef}
                        renderEmptyPane={(paneId, paneIndex) =>
                          renderEmptyPane(activeSplit.id, paneId, paneIndex)
                        }
                      />
                    </div>
                  )}
                  <SplitDropOverlay containerRef={mainAreaRef} />

                  {/* Normal-view container. Tab nodes are appended here (or to pane elements)
                  by the DOM-placement effect above. React portals each tab's content
                  into its stable per-tab node so the component is never remounted.
                  Hidden while a split is active. */}
                  <div
                    ref={normalViewRef}
                    className="absolute inset-0"
                    style={{ display: activeSplit ? "none" : undefined }}
                  >
                    {tabsByPortalOrder.map((tab) => {
                      const tabNode = getTabNode(
                        tab.id,
                        !!getTabType(tab.type)?.ownBackground,
                      );
                      const paneId = paneIdByTabId.get(tab.id);
                      const inPane = !!paneId;
                      const activeInline = !inPane && tab.id === activeTabId;
                      const isFocusedPane = inPane
                        ? paneId === focusedPaneId
                        : activeInline;
                      return createPortal(
                        <SurfaceScope
                          kind="tab"
                          className="h-full w-full"
                          onClose={
                            tab.id === "dashboard"
                              ? undefined
                              : () => closeTab(tab.id)
                          }
                        >
                          {renderTabContent(tab, {
                            shell: shellCallbacks,
                            settings: settingsTabProps,
                            panelTargetTab: terminalTabs.find(
                              (t) => t.id === targetTerminalTabId,
                            ),
                            isVisible: inPane || activeInline,
                            isFocusedPane,
                            inSplit: inPane,
                          })}
                        </SurfaceScope>,
                        tabNode,
                        tab.id,
                      );
                    })}
                  </div>
                </div>
              </div>
            </SurfaceScope>

            {/* Bottom nav bar, mobile only */}
            <MobileBar
              railView={railView}
              sidebarOpen={sidebarOpen}
              username={username}
              onRailClick={handleRailClick}
              onOpenTab={(type) => openSingletonTab(type)}
              onOpenSettings={() => openSingletonTab("settings")}
              onOpenPalette={() => setCommandPaletteOpen(true)}
              onLogout={() => onLogout({ manual: true })}
            />
          </div>

          {/* Right dock, desktop only, holds a second reference panel */}
          {!isMobile && rightRailView && (
            <DockPanel
              side="right"
              {...dockProps(rightRailView)}
              open
              width={rightSidebarWidth}
              dragging={rightSidebarDragging}
              onResizeStart={onRightSidebarMouseDown}
              onClose={() => setRightRailView(null)}
              onResetWidth={() => setRightSidebarWidth(DOCK_DEFAULT_WIDTH)}
            >
              {renderSidebarPanels(rightRailView, false)}
            </DockPanel>
          )}
        </div>
      </div>

      <ComponentSlot slotId="shell.overlay" />

      {commandPaletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            isOpen={commandPaletteOpen}
            setIsOpen={setCommandPaletteOpen}
            hosts={allHosts}
            terminalTabs={terminalTabs}
            activeTabId={activeTabId}
            onOpenPanel={(view) => handleRailClick(view as RailView)}
            onEditHost={editHostInManager}
            onOpenSettings={(section) =>
              openSingletonTab(
                "settings",
                undefined,
                undefined,
                section ? { section } : undefined,
              )
            }
            onOpenTab={(type, label, pendingEvent) => {
              if (
                [
                  "dashboard",
                  "host-manager",
                  "user-profile",
                  "admin-settings",
                  "plugins",
                ].includes(type)
              ) {
                openSingletonTab(type, pendingEvent);
              } else if (getTabType(type)?.multiInstance) {
                openMultiInstanceTab(type);
              } else if (getTabType(type)?.singleton) {
                // A singleton plugin tab, optionally preselecting a host.
                openSingletonTab(
                  type,
                  undefined,
                  label ? allHosts.find((h) => h.name === label) : undefined,
                );
              } else if (label) {
                const host = allHosts.find((h) => h.name === label);
                if (host) openTab(host, type);
              }
            }}
          />
        </Suspense>
      )}
      <OnboardingHost onOpenChange={setShowOnboarding} />
      <DonationReminderModal
        open={showDonationModal && !showOnboarding}
        onDismiss={handleDismissDonationModal}
      />
    </ServerStatusProvider>
  );
}
