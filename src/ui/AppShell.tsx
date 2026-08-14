/* eslint-disable react-refresh/only-export-components */
/* eslint-disable react-hooks/exhaustive-deps */
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Separator } from "@/components/separator";
import { Button } from "@/components/button";
import { Sheet, SheetContent } from "@/components/sheet";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  PanelRight,
  RotateCcw,
  SquareArrowOutUpRight,
} from "lucide-react";
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  createRef,
  lazy,
  Suspense,
} from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileBottomBar } from "@/shell/MobileBottomBar";
import { AppRail, type RailView } from "@/sidebar/AppRail";
import {
  railItemLabel,
  PROMOTABLE_IDS,
  RIGHT_DOCKABLE_IDS,
} from "@/sidebar/rail-items";
import { MultiPanelHint } from "@/sidebar/MultiPanelHint";
import { OnboardingDialog } from "@/onboarding/OnboardingDialog";
import { UI_ONBOARDING_VERSION } from "@/types/ui-preferences";
import { useUiPreferencesContext } from "@/contexts/UiPreferencesContext";
import { defaultSizes, SplitView, type RowColSizes } from "@/shell/SplitView";
import { renderTabContent } from "@/shell/tabUtils";
import { TabBar } from "@/shell/TabBar";

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
const SerialPanel = lazy(() =>
  import("@/sidebar/SerialPanel").then((m) => ({ default: m.SerialPanel })),
);
const SplitScreenPanel = lazy(() =>
  import("@/sidebar/SplitScreenPanel").then((m) => ({
    default: m.SplitScreenPanel,
  })),
);
const AlertManager = lazy(() =>
  import("@/dashboard/panels/alerts/AlertManager").then((m) => ({
    default: m.AlertManager,
  })),
);

// Secondary rail panels — load on first open, not with the shell critical path.
const SshToolsPanel = lazy(() =>
  import("@/sidebar/SshToolsPanel").then((m) => ({ default: m.SshToolsPanel })),
);
const SnippetsPanel = lazy(() =>
  import("@/sidebar/SnippetsPanel").then((m) => ({ default: m.SnippetsPanel })),
);
const FleetsPanel = lazy(() =>
  import("@/sidebar/FleetsPanel").then((m) => ({ default: m.FleetsPanel })),
);
const WorkspacesPanel = lazy(() =>
  import("@/sidebar/WorkspacesPanel").then((m) => ({
    default: m.WorkspacesPanel,
  })),
);
const AutomationsPanel = lazy(() =>
  import("@/sidebar/AutomationsPanel").then((m) => ({
    default: m.AutomationsPanel,
  })),
);
const AiPanel = lazy(() =>
  import("@/features/ai/AiPanel").then((m) => ({
    default: m.AiPanel,
  })),
);
const HistoryPanel = lazy(() =>
  import("@/sidebar/HistoryPanel").then((m) => ({ default: m.HistoryPanel })),
);
const SessionLogsPanel = lazy(() =>
  import("@/sidebar/SessionLogsPanel").then((m) => ({
    default: m.SessionLogsPanel,
  })),
);
const UserProfilePanel = lazy(() =>
  import("@/sidebar/UserProfilePanel").then((m) => ({
    default: m.UserProfilePanel,
  })),
);
const AdminSettingsPanel = lazy(() =>
  import("@/sidebar/AdminSettingsPanel").then((m) => ({
    default: m.AdminSettingsPanel,
  })),
);
const AlertsPanel = lazy(() =>
  import("@/sidebar/AlertsPanel").then((m) => ({ default: m.AlertsPanel })),
);
const CredentialsPanel = lazy(() =>
  import("@/sidebar/CredentialsPanel").then((m) => ({
    default: m.CredentialsPanel,
  })),
);
const TermixIdPanel = lazy(() =>
  import("@/sidebar/TermixIdPanel").then((m) => ({ default: m.TermixIdPanel })),
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
  SplitMode,
  HostFolder,
  ThemeId,
  FontSizeId,
  SerialConfig,
  Workspace,
  WorkspacePayload,
} from "@/types/ui-types";
import { applyAccentColor, applyFontSize, PANE_COUNTS } from "@/lib/theme";
import { globalShortcutHandler } from "@/lib/global-shortcut-handler";
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
  isElectron,
  type UserPreferences,
  type OpenTabRecord,
} from "@/main-axios";
import {
  listWorkspaces,
  applyWorkspaceServer,
  saveLastSessionWorkspace,
} from "@/api/workspaces-api";
import {
  buildWorkspacePayload as buildWorkspacePayloadUtil,
  remapSlotIds,
  resolveWorkspaceTabTarget,
} from "@/shell/workspaceUtils";
import { DonationReminderModal } from "@/user/DonationReminderModal.tsx";
import { RemoteSyncBanner } from "@/components/RemoteSyncBanner.tsx";
import { MigrationNoticeDialog } from "@/components/MigrationNoticeDialog.tsx";
import { dbHealthMonitor } from "@/lib/db-health-monitor";
import { ServerStatusProvider } from "@/lib/ServerStatusContext";
import { TransferMonitor } from "@/features/file-manager/TransferMonitor.tsx";
import { sshHostToHost } from "@/sidebar/HostManagerData";
import { resolveHostTabType } from "@/lib/host-connection-tabs";
import { changeAppLanguage, consumeLoginLanguage } from "@/i18n/i18n";
import { quickConnectHostToPayload } from "@/sidebar/quick-connect-host";
import { buildHostTree } from "@/sidebar/build-host-tree";
import {
  assignTabsToSplit,
  createSplitConfig,
  releaseSplitTabs,
  restoreSplitTabs,
  serializeSplitTabs,
  type PersistedSplitTab,
} from "@/shell/splitTabUtils";

export { buildHostTree } from "@/sidebar/build-host-tree";
export { tabIcon, renderTabContent } from "@/shell/tabUtils";

// ─── AppShell ────────────────────────────────────────────────────────────────

export function AppShell({
  username,
  onLogout,
}: {
  username: string;
  onLogout: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { setTheme } = useTheme();
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
  // Flips to true once the initial DB read (restore or skip) is done — sync must not fire before this
  const [tabsReady, setTabsReady] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [splitMode, setSplitMode] = useState<SplitMode>("none");
  // paneTabIds holds live tab.id values, which change on every restore, so we
  // can't restore it from storage directly. It starts empty and gets filled in
  // once by the reconciliation effect below, keyed off the stable instanceId
  // values saved in termix_paneInstanceIds.
  const [paneTabIds, setPaneTabIds] = useState<(string | null)[]>(() =>
    Array(6).fill(null),
  );
  const paneLayoutRestoredRef = useRef(false);
  const splitTabsRestoredRef = useRef(false);
  useEffect(() => {
    paneTabIdsRef.current = paneTabIds;
  }, [paneTabIds]);
  const [rowSizes, setRowSizes] = useState<number[]>(
    () => defaultSizes("none").rowSizes,
  );
  const [rowColSizes, setRowColSizes] = useState<RowColSizes>(
    () => defaultSizes("none").rowColSizes,
  );
  const changeSplitMode = useCallback((mode: SplitMode) => {
    setSplitMode(mode);
    const d = defaultSizes(mode);
    setRowSizes(d.rowSizes);
    setRowColSizes(d.rowColSizes);
  }, []);
  const [focusedPaneIndex, setFocusedPaneIndex] = useState<number | null>(null);
  const [realHostTree, setRealHostTree] = useState<HostFolder | null>(null);
  const [hostsLoading, setHostsLoading] = useState(true);
  const [allHosts, setAllHosts] = useState<Host[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  // The standalone desktop backend still owns system settings such as the
  // Tailscale API key, even though it has only one implicit user.
  const showAdminUI = isAdmin;
  const [userId, setUserId] = useState<string | null>(null);
  const [showDonationModal, setShowDonationModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingHasHosts, setOnboardingHasHosts] = useState(false);
  const [onboardingAiEnabled, setOnboardingAiEnabled] = useState(false);
  const [backgroundTabRecords, setBackgroundTabRecords] = useState<
    OpenTabRecord[]
  >([]);

  // First-run onboarding. The backend hands accounts that predate this feature
  // an already-completed state, so only genuinely new users are interrupted.
  const uiPrefs = useUiPreferencesContext();
  const onboardingPending =
    !!uiPrefs?.loaded &&
    uiPrefs.preferences.onboarding.completedVersion < UI_ONBOARDING_VERSION;

  /**
   * Both onboarding entry points resolve the same context first: whether the
   * account has hosts, and whether an admin has enabled the AI assistant. The
   * AI step is skipped entirely when it is off, so the answer has to be in
   * before the dialog opens.
   */
  const loadOnboardingContext = useCallback(async () => {
    const [hosts, aiStatus] = await Promise.allSettled([
      getSSHHosts(),
      import("@/api/ai-api").then(({ getAiStatus }) => getAiStatus()),
    ]);
    if (hosts.status === "fulfilled") {
      setOnboardingHasHosts((hosts.value?.length ?? 0) > 0);
    }
    setOnboardingAiEnabled(
      aiStatus.status === "fulfilled" ? aiStatus.value.globallyEnabled : false,
    );
  }, []);

  useEffect(() => {
    if (!username || !onboardingPending) return;
    let cancelled = false;
    loadOnboardingContext().finally(() => {
      if (!cancelled) setShowOnboarding(true);
    });
    return () => {
      cancelled = true;
    };
  }, [username, onboardingPending, loadOnboardingContext]);

  // "Run setup again" from settings.
  useEffect(() => {
    const handler = () => {
      loadOnboardingContext().finally(() => setShowOnboarding(true));
    };
    window.addEventListener("termix:open-onboarding", handler);
    return () => window.removeEventListener("termix:open-onboarding", handler);
  }, [loadOnboardingContext]);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [railView, setRailView] = useState<RailView>("hosts");
  const [remoteSyncInitialServerUrl, setRemoteSyncInitialServerUrl] = useState<
    string | undefined
  >(undefined);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("termix_sidebarWidth");
    return saved ? parseInt(saved, 10) : 291;
  });
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [sidebarEditing, setSidebarEditing] = useState(false);
  const [settingsFullscreen, setSettingsFullscreen] = useState(false);

  // Right dock — a second panel column so reference panels like history can
  // stay visible while the left sidebar is used for something else.
  const [rightRailView, setRightRailView] = useState<RailView | null>(() => {
    const saved = localStorage.getItem("termix_rightRailView");
    return saved && RIGHT_DOCKABLE_IDS.includes(saved)
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
  const isSettingsView =
    railView === "user-profile" || railView === "admin-settings";

  useEffect(() => {
    if (!settingsFullscreen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsFullscreen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsFullscreen]);

  useEffect(() => {
    if (!isSettingsView) setSettingsFullscreen(false);
  }, [isSettingsView]);

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
        setUserId(info.userId);
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
        toast.error("Fullscreen is not supported by this browser");
        return;
      }

      await document.documentElement.requestFullscreen();
    } catch {
      toast.error("Unable to toggle fullscreen mode");
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

  const lastShiftTime = useRef(0);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const closeActiveTabRef = useRef<() => void>(() => {});
  const splitModeRef = useRef(splitMode);
  const focusedPaneIndexRef = useRef<number | null>(null);
  const paneContentElsRef = useRef<(HTMLDivElement | null)[]>(
    Array(6).fill(null),
  );
  const paneTabIdsRef = useRef<(string | null)[]>(Array(6).fill(null));
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);
  useEffect(() => {
    return window.electronAPI?.onCloseActiveTab?.(() =>
      closeActiveTabRef.current(),
    );
  }, []);
  const skipSplitSyncRef = useRef(false);
  useEffect(() => {
    const active = tabsRef.current.find((tab) => tab.id === activeTabId);
    const config = active?.type === "split-screen" ? active.splitConfig : null;
    skipSplitSyncRef.current = true;
    if (!config) {
      setSplitMode("none");
      setPaneTabIds(Array(6).fill(null));
      setFocusedPaneIndex(null);
      return;
    }
    setSplitMode(config.mode);
    setPaneTabIds(config.paneTabIds);
    setRowSizes(config.rowSizes);
    setRowColSizes(config.rowColSizes);
    setFocusedPaneIndex(0);
  }, [activeTabId]);

  useEffect(() => {
    if (skipSplitSyncRef.current) {
      skipSplitSyncRef.current = false;
      return;
    }
    if (splitMode === "none") return;
    setTabs((prev) => {
      const active = prev.find((tab) => tab.id === activeTabId);
      if (active?.type !== "split-screen") return prev;
      const config = createSplitConfig(splitMode, paneTabIds, {
        rowSizes,
        rowColSizes,
      });
      const updated = prev.map((tab) =>
        tab.id === activeTabId ? { ...tab, splitConfig: config } : tab,
      );
      return assignTabsToSplit(updated, activeTabId, paneTabIds);
    });
  }, [activeTabId, paneTabIds, rowColSizes, rowSizes, splitMode]);
  // Panels like history and snippets act on "the terminal you're working in".
  // Once those panels can themselves be the active tab, activeTabId points at
  // the panel and the lookup misses, so remember the last terminal instead.
  const [lastTerminalTabId, setLastTerminalTabId] = useState(activeTabId);
  useEffect(() => {
    const active = tabs.find((t) => t.id === activeTabId);
    if (active?.type === "terminal") setLastTerminalTabId(active.id);
  }, [activeTabId, tabs]);
  useEffect(() => {
    splitModeRef.current = splitMode;
  }, [splitMode]);
  useEffect(() => {
    focusedPaneIndexRef.current = focusedPaneIndex;
  }, [focusedPaneIndex]);
  const [commandPaletteShortcutEnabled, setCommandPaletteShortcutEnabled] =
    useState<boolean>(() => {
      const v = localStorage.getItem("commandPaletteShortcutEnabled");
      return v !== null ? v === "true" : true;
    });
  const terminalRefs = useRef<Map<string, ReturnType<typeof createRef>>>(
    new Map(),
  );
  const [paneContentEls, setPaneContentEls] = useState<
    (HTMLDivElement | null)[]
  >(Array(6).fill(null));
  useEffect(() => {
    paneContentElsRef.current = paneContentEls;
  }, [paneContentEls]);

  // Stable per-tab DOM nodes — created once per tab, never destroyed while the tab lives.
  // We always portal each tab's content into its own node, then move that node between
  // the normal-view container and the pane container via vanilla DOM so React's portal
  // target never changes (changing the target causes a remount).
  const tabNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const normalViewRef = useRef<HTMLDivElement>(null);

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

  const onPaneContentRef = useCallback(
    (paneIndex: number, el: HTMLDivElement | null) => {
      setPaneContentEls((prev) => {
        if (prev[paneIndex] === el) return prev;
        const next = [...prev];
        next[paneIndex] = el;
        return next;
      });
    },
    [],
  );

  // Titles come from the shared rail definitions so they stay translated and
  // in step with the rail itself.
  const sidebarTitle = (view: RailView): string => railItemLabel(view, t);

  // Double-shift or Ctrl+K opens the command palette. Double-shift alone was
  // hard to discover.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "ShiftLeft" && !e.repeat) {
        const now = Date.now();
        if (now - lastShiftTime.current < 300 && commandPaletteShortcutEnabled)
          setCommandPaletteOpen((prev) => !prev);
        lastShiftTime.current = now;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.code === "KeyK" &&
        commandPaletteShortcutEnabled
      ) {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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

      // Ctrl+Shift+\ — toggle 2-way split (side by side)
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === "Backslash") {
        e.preventDefault();
        if (splitModeRef.current !== "none") {
          selectSplitMode("none");
        } else {
          selectSplitMode("2-way");
        }
        return;
      }

      // Ctrl+Shift+- — toggle 3-way-horizontal split (top/bottom)
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === "Minus") {
        e.preventDefault();
        if (splitModeRef.current !== "none") {
          selectSplitMode("none");
        } else {
          selectSplitMode("3-way-horizontal");
        }
        return;
      }

      // Alt+Arrow — navigate between panes in split mode
      if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        if (
          e.code === "ArrowLeft" ||
          e.code === "ArrowRight" ||
          e.code === "ArrowUp" ||
          e.code === "ArrowDown"
        ) {
          if (splitModeRef.current === "none") return;
          const count = PANE_COUNTS[splitModeRef.current];
          if (count < 2) return;
          e.preventDefault();
          const current = focusedPaneIndexRef.current ?? 0;
          const mode = splitModeRef.current;
          const dir = e.code;

          // Layout-aware navigation maps: [left, right, up, down] per pane index.
          // null means no movement in that direction.
          const navMap: Record<string, (number | null)[][]> = {
            "2-way": [
              [null, 1, null, null],
              [0, null, null, null],
            ],
            "2-way-horizontal": [
              [null, null, null, 1],
              [null, null, 0, null],
            ],
            "3-way": [
              [null, 1, null, null],
              [0, null, null, 2],
              [0, null, 1, null],
            ],
            "3-way-horizontal": [
              [null, 1, null, 2],
              [0, null, null, 2],
              [null, null, 0, null],
            ],
            "4-way": [
              [null, 1, null, 2],
              [0, null, null, 3],
              [null, 3, 0, null],
              [2, null, 1, null],
            ],
            "5-way": [
              [null, 1, null, 3],
              [0, 2, null, 4],
              [1, null, null, 4],
              [null, 4, 0, null],
              [3, null, 1, null],
            ],
            "6-way": [
              [null, 1, null, 3],
              [0, 2, null, 4],
              [1, null, null, 5],
              [null, 4, 0, null],
              [3, 5, 1, null],
              [4, null, 2, null],
            ],
          };

          const paneNav = navMap[mode]?.[current];
          const dirIndex =
            { ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3 }[dir] ??
            -1;
          const next = paneNav?.[dirIndex] ?? null;
          if (next === null) return;

          focusedPaneIndexRef.current = next;
          setFocusedPaneIndex(next);
          // Physically move DOM focus into the target pane's terminal
          const tabId = paneTabIdsRef.current[next];
          if (tabId) {
            const termRef = terminalRefs.current.get(tabId);
            (
              termRef?.current as
                import("@/features/terminal/Terminal").TerminalHandle | null
            )?.focus();
          }
          return;
        }

        // Alt+1..9 — jump directly to the tab at that position
        const digitMatch = /^Digit([1-9])$/.exec(e.code);
        if (digitMatch) {
          const currentTabs = tabsRef.current;
          const index = Number(digitMatch[1]) - 1;
          if (index < currentTabs.length) {
            e.preventDefault();
            setActiveTabId(currentTabs[index].id);
          }
          return;
        }
      }

      // Ctrl+Shift+] / Ctrl+Shift+[ — cycle through open tabs (] = next, [ = previous)
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        if (e.code === "BracketRight" || e.code === "BracketLeft") {
          e.preventDefault();
          const currentTabs = tabsRef.current;
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
    const handle = () => onLogout();
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
              "i18nextLng",
              "commandAutocomplete",
              "commandPaletteShortcutEnabled",
              "showHostTags",
              "hostTrayOnClick",
              "pinAppRail",
              "expandAppRailOnHover",
              "defaultSnippetFoldersCollapsed",
              "confirmSnippetExecution",
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
            prefs.commandAutocomplete !== null &&
            prefs.commandAutocomplete !== undefined
          )
            localStorage.setItem(
              "commandAutocomplete",
              String(prefs.commandAutocomplete),
            );
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
            prefs.foldersCollapsed !== null &&
            prefs.foldersCollapsed !== undefined
          )
            localStorage.setItem(
              "defaultSnippetFoldersCollapsed",
              String(prefs.foldersCollapsed),
            );
          if (
            prefs.confirmSnippetExecution !== null &&
            prefs.confirmSnippetExecution !== undefined
          )
            localStorage.setItem(
              "confirmSnippetExecution",
              String(prefs.confirmSnippetExecution),
            );
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
        { color?: string; icon?: string; credentialId?: number | null }
      >();
      for (const f of folders) {
        folderMeta.set(f.name, {
          color: f.color ?? undefined,
          icon: f.icon ?? undefined,
          credentialId: f.credentialId ?? null,
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

  // The Electron main process runs remote sync (pull/push hosts and
  // credentials with a connected Termix server) on its own timer, entirely
  // outside any renderer-initiated action, so nothing normally dispatches
  // the termix:hosts-changed / termix:credentials-changed events that
  // panels rely on to refetch. Without this, newly-synced hosts/credentials
  // only show up after a manual refresh or app restart.
  useEffect(() => {
    if (!isElectron()) return;
    let wasSyncing = false;
    const unsubscribe = window.electronAPI?.onRemoteSyncStatusChanged?.(
      (status: { syncing: boolean; lastError: string | null }) => {
        const justFinished = wasSyncing && !status.syncing && !status.lastError;
        wasSyncing = status.syncing;
        if (justFinished) {
          window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
          window.dispatchEvent(new CustomEvent("termix:credentials-changed"));
        }
      },
    );
    return () => unsubscribe?.();
  }, []);

  // Sync tab host data when allHosts updates (e.g. after editing terminal theme in host settings)
  useEffect(() => {
    if (allHosts.length === 0) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.host
          ? { ...t, host: allHosts.find((h) => h.id === t.host!.id) ?? t.host }
          : t,
      ),
    );
  }, [allHosts]);

  // Let HostManager trigger tab opens via custom event
  useEffect(() => {
    const handle = (e: Event) => {
      const { hostId, type } = (
        e as CustomEvent<{ hostId: string; type?: TabType }>
      ).detail;
      const host = allHosts.find((h) => h.id === hostId);
      if (host) connectHost(host, type);
    };
    window.addEventListener("termix:open-tab", handle);
    return () => window.removeEventListener("termix:open-tab", handle);
  }, [allHosts]);

  const PERSISTENT_TAB_TYPES: TabType[] = [
    "terminal",
    "rdp",
    "vnc",
    "telnet",
    "files",
    "docker",
    "host-metrics",
    "tunnel",
  ];

  function buildWorkspacePayload(): WorkspacePayload {
    return buildWorkspacePayloadUtil({
      tabs,
      activeTabId,
      splitMode,
      paneTabIds,
      rowSizes,
      rowColSizes,
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

  async function applyWorkspace(workspace: Workspace) {
    // Tear down the current arrangement the same way an individual tab close does.
    for (const tab of [...tabsRef.current]) {
      doCloseTab(tab.id);
    }

    const slotIdToNewTabId = new Map<string, string>();
    const skippedTabs: string[] = [];

    for (const snapshot of workspace.payload.tabs) {
      const target = resolveWorkspaceTabTarget(snapshot, allHosts);

      if (target.kind === "skip") {
        skippedTabs.push(snapshot.hostNameSnapshot || snapshot.label);
        continue;
      }

      if (target.kind === "serial" && snapshot.serialConfig) {
        const newTabId = openSerialTab(snapshot.serialConfig);
        slotIdToNewTabId.set(snapshot.slotId, newTabId);
        continue;
      }

      if (target.kind === "singleton") {
        openSingletonTab(
          snapshot.type,
          undefined,
          target.host,
          snapshot.fleetId,
        );
        slotIdToNewTabId.set(snapshot.slotId, snapshot.type);
        continue;
      }

      if (target.kind === "host") {
        const newTabId = openTab(target.host, snapshot.type, {
          instanceId: crypto.randomUUID(),
          restoredSessionId: null,
          savedLabel: snapshot.customLabel ?? snapshot.label,
          initialFilePath: snapshot.initialFilePath,
          initialPath: snapshot.initialPath,
        });
        slotIdToNewTabId.set(snapshot.slotId, newTabId);
      }
    }

    const restoredPaneIds = remapSlotIds(
      workspace.payload.paneTabIds,
      slotIdToNewTabId,
    );
    let restoredSplitTabId: string | null = null;
    if (
      workspace.payload.splitMode !== "none" &&
      restoredPaneIds.some(Boolean)
    ) {
      const instanceId = crypto.randomUUID();
      restoredSplitTabId = `split-${instanceId}`;
      const splitTab: Tab = {
        id: restoredSplitTabId,
        instanceId,
        type: "split-screen",
        label: workspace.name,
        openedAt: Date.now(),
        splitConfig: createSplitConfig(
          workspace.payload.splitMode,
          restoredPaneIds,
          workspace.payload,
        ),
      };
      setTabs((prev) =>
        assignTabsToSplit([...prev, splitTab], splitTab.id, restoredPaneIds),
      );
    }

    const activeId = workspace.payload.activeSlotId
      ? (slotIdToNewTabId.get(workspace.payload.activeSlotId) ?? "dashboard")
      : "dashboard";
    setActiveTabId(restoredSplitTabId ?? activeId);

    // Older payloads predate the sidebar field, so leave the docks alone then.
    const sidebar = workspace.payload.sidebar;
    if (sidebar) {
      if (sidebar.left.view) setRailView(sidebar.left.view as RailView);
      setSidebarOpen(sidebar.left.open);
      if (sidebar.left.width) setSidebarWidth(sidebar.left.width);

      const right = sidebar.right.open ? sidebar.right.view : null;
      setRightRailView(
        right && RIGHT_DOCKABLE_IDS.includes(right)
          ? (right as RailView)
          : null,
      );
      if (sidebar.right.width) setRightSidebarWidth(sidebar.right.width);
    }

    if (skippedTabs.length > 0) {
      toast.warning(
        t("newUi.sidebar.workspaces.tabsSkipped", {
          count: skippedTabs.length,
          names: skippedTabs.join(", "),
        }),
      );
    }

    applyWorkspaceServer(workspace.id).catch(() => {});
  }

  // On load: always read saved tabs from DB so background sessions are preserved across refreshes.
  // If reopenTabsOnLogin is on, also restore them as open tabs in the tab bar.
  const tabRestoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (!hostsLoaded || !userPrefsLoaded) return;
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
            PERSISTENT_TAB_TYPES.includes(t.type),
          );
          if (!hasPersistentTabs) {
            const restoredTabs: Tab[] = [];
            for (const saved of savedTabs as OpenTabRecord[]) {
              const host = saved.hostId
                ? allHosts.find((h) => h.id === String(saved.hostId))
                : undefined;
              const hostlessTypes: TabType[] = ["dashboard", "tunnel"];
              if (!host && !hostlessTypes.includes(saved.tabType as TabType))
                continue;

              if (host) {
                if (saved.tabType === "terminal" && !host.enableSsh) continue;
                if (saved.tabType === "rdp" && !host.enableRdp) continue;
                if (saved.tabType === "vnc" && !host.enableVnc) continue;
                if (saved.tabType === "telnet" && !host.enableTelnet) continue;
              }

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
                terminalRef: SESSION_TAB_TYPES.includes(
                  saved.tabType as TabType,
                )
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
          // Not restoring to tab bar — keep as background records for ConnectionsPanel
          setBackgroundTabRecords(savedTabs as OpenTabRecord[]);
        }
      } catch {
        // silently fail
      } finally {
        setTabsReady(true);
      }
    }

    loadSavedTabs();
  }, [hostsLoaded, userPrefsLoaded]);

  // If reopenTabsOnLogin didn't already restore anything (off, or on but
  // nothing to restore), auto-apply the user's default workspace if they set
  // one. Runs once, after the open-tabs restore above has had its chance —
  // that path wins when both would otherwise fire, since it's more granular
  // and live-session-aware than a workspace snapshot.
  const defaultWorkspaceAttemptedRef = useRef(false);
  useEffect(() => {
    if (!tabsReady || defaultWorkspaceAttemptedRef.current) return;
    defaultWorkspaceAttemptedRef.current = true;

    const hasPersistentTabs = tabs.some((t) =>
      PERSISTENT_TAB_TYPES.includes(t.type),
    );
    if (userPrefs.reopenTabsOnLogin && hasPersistentTabs) return;

    listWorkspaces()
      .then((workspaces) => {
        const defaultWorkspace = workspaces.find(
          (w) => w.kind === "manual" && w.isDefault,
        );
        if (defaultWorkspace) {
          applyWorkspace(defaultWorkspace);
        }
      })
      .catch(() => {});
  }, [tabsReady]);

  // Restore named split tabs once their child sessions have stable live ids. The old
  // singleton keys are migrated once into Split #1 so existing layouts are preserved.
  useEffect(() => {
    if (!tabsReady || paneLayoutRestoredRef.current) return;
    paneLayoutRestoredRef.current = true;

    try {
      const savedSplitTabs = JSON.parse(
        localStorage.getItem("termix_splitTabs") ?? "[]",
      ) as PersistedSplitTab[];
      if (Array.isArray(savedSplitTabs) && savedSplitTabs.length > 0) {
        setTabs((prev) => restoreSplitTabs(savedSplitTabs, prev));
        splitTabsRestoredRef.current = true;
        return;
      }

      const savedInstanceIds: (string | null)[] = JSON.parse(
        localStorage.getItem("termix_paneInstanceIds") ?? "null",
      );
      const savedMode = localStorage.getItem("termix_splitMode") as SplitMode;
      if (
        !Array.isArray(savedInstanceIds) ||
        !savedMode ||
        savedMode === "none"
      ) {
        splitTabsRestoredRef.current = true;
        return;
      }

      const restored = savedInstanceIds.map((instanceId) => {
        if (instanceId == null) return null;
        return tabs.find((t) => t.instanceId === instanceId)?.id ?? null;
      });
      if (restored.some((id) => id != null)) {
        let sizes = defaultSizes(savedMode);
        try {
          const savedSizes = JSON.parse(
            localStorage.getItem("termix_paneSizes") ?? "null",
          ) as { rowSizes?: number[]; rowColSizes?: RowColSizes } | null;
          if (
            Array.isArray(savedSizes?.rowSizes) &&
            Array.isArray(savedSizes?.rowColSizes)
          ) {
            sizes = {
              rowSizes: savedSizes.rowSizes,
              rowColSizes: savedSizes.rowColSizes,
            };
          }
        } catch {
          // silently fail
        }
        const instanceId = crypto.randomUUID();
        const id = `split-${instanceId}`;
        const splitTab: Tab = {
          id,
          instanceId,
          type: "split-screen",
          label: "Split #1",
          openedAt: Date.now(),
          splitConfig: createSplitConfig(savedMode, restored, sizes),
        };
        setTabs((prev) => assignTabsToSplit([...prev, splitTab], id, restored));
        setActiveTabId(id);
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
    const persistable = tabs.filter((t) =>
      PERSISTENT_TAB_TYPES.includes(t.type),
    );
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

  // Debounced "Last Session" auto-save: keeps an implicit workspace snapshot
  // current so the arrangement can always be recovered, even if the user never
  // manually saves one. Never auto-applied on login — see the default-workspace
  // effect above, which only considers kind === "manual" rows.
  const lastSessionSaveTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  useEffect(() => {
    if (!tabsReady) return;
    if (lastSessionSaveTimeoutRef.current)
      clearTimeout(lastSessionSaveTimeoutRef.current);
    lastSessionSaveTimeoutRef.current = setTimeout(() => {
      saveLastSessionWorkspace(buildWorkspacePayload()).catch(() => {});
    }, 2000);

    return () => {
      if (lastSessionSaveTimeoutRef.current)
        clearTimeout(lastSessionSaveTimeoutRef.current);
    };
  }, [
    tabs,
    paneTabIds,
    splitMode,
    rowSizes,
    rowColSizes,
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
      initialFilePath?: string;
      initialPath?: string;
      serialConfig?: SerialConfig;
      joinSharedSessionId?: string | null;
      joinShareId?: string | null;
    },
  ) {
    const tabId = `${host.name}-${type}-${Date.now()}`;
    const instanceId =
      restore?.instanceId ??
      (typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
    const openedAt = Date.now();
    const ref = SESSION_TAB_TYPES.includes(type) ? createRef() : undefined;
    if (ref) terminalRefs.current.set(tabId, ref);

    let finalLabel = host.name;
    const savedLabel = restore?.savedLabel;
    const initialFilePath = restore?.initialFilePath;
    const initialPath = restore?.initialPath;
    const serialConfig = restore?.serialConfig;
    const joinSharedSessionId = restore?.joinSharedSessionId ?? null;
    const joinShareId = restore?.joinShareId ?? null;
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
            joinSharedSessionId,
            joinShareId,
            initialFilePath,
            initialPath,
            serialConfig,
          },
        ];
      }

      const same = prev.filter(
        (t) =>
          t.type === type && t.label.replace(/ \(\d+\)$/, "") === host.name,
      );
      finalLabel =
        same.length === 0 ? host.name : `${host.name} (${same.length + 1})`;

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
          joinSharedSessionId,
          joinShareId,
          initialFilePath,
          initialPath,
          serialConfig,
        },
      ];
    });
    setActiveTabId(tabId);

    if (PERSISTENT_TAB_TYPES.includes(type)) {
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

  function connectHost(host: Host, preferredType?: TabType) {
    const type = resolveHostTabType(host, preferredType);
    // --- tmux-monitor --- singleton tab, not a per-host tab
    if (type === "tmux_monitor") {
      openSingletonTab(type, undefined, host);
      return;
    }
    openTab(host, type);
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

  function openSerialTab(config: SerialConfig): string {
    const pseudoHost: Host = {
      id: `serial-${Date.now()}`,
      name: config.path
        ? `${config.path} (${config.baudRate})`
        : `Serial (${config.baudRate})`,
      username: "",
      ip: "",
      port: 0,
      folder: "",
      online: false,
      cpu: null,
      ram: null,
      lastAccess: new Date().toISOString(),
      authType: "none",
      enableTerminal: false,
      enableCommandHistory: false,
      enableTunnel: false,
      enableFileManager: false,
      enableDocker: false,
      enableProxmox: false,
      enableProxmoxStats: false,
      enableTmuxMonitor: false,
      enableTerminalToolbar: false,
      enableSsh: false,
      enableRdp: false,
      enableVnc: false,
      enableTelnet: false,
      sshPort: 22,
      rdpPort: 3389,
      vncPort: 5900,
      telnetPort: 23,
      serverTunnels: [],
      quickActions: [],
    };
    const instanceId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return openTab(pseudoHost, "serial", {
      instanceId,
      restoredSessionId: null,
      serialConfig: config,
    });
  }

  const openSingletonTab = useCallback(
    // --- tmux-monitor --- (added optional `host` so tmux_monitor can open
    // with a preselected host; existing callers are unaffected)
    function openSingletonTab(
      type: TabType,
      pendingEvent?: string,
      host?: Host,
      fleetId?: number,
    ) {
      if (type === "host-manager") {
        if (pendingEvent === "host-manager:add-credential") {
          setSidebarOpen(true);
          setRailView("credentials");
          setTimeout(
            () =>
              window.dispatchEvent(
                new CustomEvent("host-manager:add-credential"),
              ),
            0,
          );
        } else if (pendingEvent === "host-manager:show-credentials") {
          setSidebarOpen(true);
          setRailView("credentials");
        } else {
          setSidebarOpen(true);
          setRailView("hosts");
          if (pendingEvent) {
            setTimeout(
              () => window.dispatchEvent(new CustomEvent(pendingEvent)),
              0,
            );
          }
        }
        return;
      }
      if (type === "user-profile" || type === "admin-settings") {
        setSidebarEditing(false);
        setRailView(type as RailView);
        setSidebarOpen(true);
        return;
      }
      const id = type;
      const singletonLabels: Partial<Record<TabType, string>> = {
        "host-manager": t("nav.hostManager"),
        docker: t("nav.docker"),
        tunnel: t("nav.tunnels"),
        network_graph: t("nav.networkGraph"),
        tmux_monitor: t("nav.tmuxMonitor"), // --- tmux-monitor ---
        homepage: t("nav.homepage"),
        "fleet-inventory": t("nav.fleets"),
      };
      // Promoted rail panels reuse the rail's own label so the two stay in sync.
      const label = singletonLabels[type] ?? railItemLabel(type, t);
      setTabs((prev) => {
        const existing = prev.find((t) => t.id === id);
        if (existing) {
          // --- tmux-monitor --- refocusing with a host preselects it
          if (!host && fleetId === undefined) return prev;
          return prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  ...(host ? { host } : {}),
                  ...(fleetId !== undefined ? { fleetId } : {}),
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
            ...(host ? { host } : {}), // --- tmux-monitor ---
            ...(fleetId !== undefined ? { fleetId } : {}),
          },
        ];
      });
      setActiveTabId(id);
      if (PERSISTENT_TAB_TYPES.includes(type)) {
        addOpenTab({
          id,
          tabType: type,
          hostId: null,
          label,
          tabOrder: 0,
        }).catch(() => {});
      }
    },
    [t],
  );

  const SESSION_TAB_TYPES: TabType[] = [
    "terminal",
    "rdp",
    "vnc",
    "telnet",
    "serial",
  ];
  const ACTIVE_CLOSE_CONFIRM_TYPES: TabType[] = SESSION_TAB_TYPES;

  const getTabCloseLabel = useCallback((tab: Tab) => {
    return tab.customLabel || tab.label || tab.host?.name || String(tab.id);
  }, []);

  const isActiveConnectionTab = useCallback((tab: Tab) => {
    if (!ACTIVE_CLOSE_CONFIRM_TYPES.includes(tab.type)) return false;
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

  function doCloseTab(id: string) {
    const tabToClose = tabs.find((t) => t.id === id);
    if (tabToClose?.terminalRef?.current?.disconnect) {
      tabToClose.terminalRef.current.disconnect();
    }
    if (
      tabToClose?.instanceId &&
      PERSISTENT_TAB_TYPES.includes(tabToClose.type)
    ) {
      deleteOpenTab(tabToClose.instanceId).catch(() => {});
    }

    terminalRefs.current.delete(id);
    if (id === activeTabId) {
      const remaining = tabs.filter(
        (tab) => tab.id !== id && !tab.parentSplitTabId,
      );
      setActiveTabId(
        remaining.length > 0 ? remaining[remaining.length - 1].id : "dashboard",
      );
    }
    setPaneTabIds((prev) => prev.map((p) => (p === id ? null : p)));
    setTabs((prev) => {
      const next =
        tabToClose?.type === "split-screen"
          ? releaseSplitTabs(prev, id)
          : prev
              .filter((tab) => tab.id !== id)
              .map((tab) =>
                tab.type === "split-screen" && tab.splitConfig
                  ? {
                      ...tab,
                      splitConfig: {
                        ...tab.splitConfig,
                        paneTabIds: tab.splitConfig.paneTabIds.map((paneId) =>
                          paneId === id ? null : paneId,
                        ),
                      },
                    }
                  : tab,
              );
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

  function refreshTab(id: string) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.type === "terminal") {
      const ref = tab.terminalRef?.current;
      ref?.reconnect?.();
    } else if (["rdp", "vnc", "telnet"].includes(tab.type)) {
      window.dispatchEvent(
        new CustomEvent("termix:refresh-guacamole", { detail: { tabId: id } }),
      );
    }
  }

  function openShareForTab(id: string) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    const ref = tab.terminalRef?.current;
    if (ref?.canShare?.()) {
      ref.openShareModal?.();
    } else {
      toast.error(t("sessionSharing.notReadyToShare"));
    }
  }

  function closeTab(id: string) {
    const tab = tabs.find((t) => t.id === id);
    const confirmEnabled = localStorage.getItem("confirmTabClose") === "true";
    if (tab && confirmEnabled && isActiveConnectionTab(tab)) {
      const closeLabel = getTabCloseLabel(tab);
      const toastId = `close-tab-${id}`;
      toast(
        t("nav.confirmCloseHost", {
          host: closeLabel,
          defaultValue: `Close ${closeLabel}?`,
        }),
        {
          id: toastId,
          duration: 8000,
          action: {
            label: t("nav.close"),
            onClick: () => {
              toast.dismiss(toastId);
              doCloseTab(id);
            },
          },
          cancel: {
            label: t("nav.cancel"),
            onClick: () => toast.dismiss(toastId),
          },
        },
      );
      return;
    }

    if (tab && SESSION_TAB_TYPES.includes(tab.type) && confirmEnabled) {
      toast.dismiss(`close-tab-${id}`);
    }

    doCloseTab(id);
  }

  closeActiveTabRef.current = () => {
    const id = activeTabIdRef.current;
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

  function splitTabQuick(tabId: string, mode: SplitMode) {
    if (mode === "none") return;
    const count = PANE_COUNTS[mode];
    const paneIds: (string | null)[] = Array(6).fill(null);
    paneIds[0] = tabId;
    let slot = 1;
    for (const tab of tabs) {
      if (slot >= count) break;
      if (
        tab.id !== tabId &&
        tab.type !== "dashboard" &&
        tab.type !== "split-screen" &&
        !tab.parentSplitTabId
      ) {
        paneIds[slot++] = tab.id;
      }
    }
    const splitNumber =
      tabs.filter((tab) => tab.type === "split-screen").length + 1;
    const instanceId = crypto.randomUUID();
    const id = `split-${instanceId}`;
    const sizes = defaultSizes(mode);
    const splitTab: Tab = {
      id,
      instanceId,
      type: "split-screen",
      label: `Split #${splitNumber}`,
      openedAt: Date.now(),
      splitConfig: createSplitConfig(mode, paneIds, sizes),
    };
    setTabs((prev) => assignTabsToSplit([...prev, splitTab], id, paneIds));
    setActiveTabId(id);
    setSplitMode(mode);
    setPaneTabIds(paneIds);
    setRowSizes(sizes.rowSizes);
    setRowColSizes(sizes.rowColSizes);
  }

  function addTabToSplit(tabId: string) {
    if (splitMode === "none") {
      splitTabQuick(tabId, "2-way");
      return;
    }
    setPaneTabIds((prev) => {
      // Remove from any current slot first
      const next = prev.map((p) => (p === tabId ? null : p));
      // Find first empty slot within the current pane count
      const count = PANE_COUNTS[splitMode];
      for (let i = 0; i < count; i++) {
        if (!next[i]) {
          next[i] = tabId;
          break;
        }
      }
      return next;
    });
  }

  function removeTabFromSplit(tabId: string) {
    setPaneTabIds((prev) => prev.map((p) => (p === tabId ? null : p)));
  }

  function selectSplitMode(mode: SplitMode) {
    const active = tabs.find((tab) => tab.id === activeTabId);
    if (mode === "none") {
      if (active?.type === "split-screen") doCloseTab(active.id);
      return;
    }
    if (active?.type === "split-screen") {
      changeSplitMode(mode);
      return;
    }
    if (active && active.type !== "dashboard") {
      splitTabQuick(active.id, mode);
      return;
    }
    const firstSession = tabs.find(
      (tab) =>
        tab.type !== "dashboard" &&
        tab.type !== "split-screen" &&
        !tab.parentSplitTabId,
    );
    if (firstSession) splitTabQuick(firstSession.id, mode);
  }

  function assignPane(paneIndex: number, tabId: string) {
    setPaneTabIds((prev) => {
      const next = prev.map((p) => (p === tabId ? null : p));
      next[paneIndex] = tabId || null;
      return next;
    });
  }

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
    const fallback = lastRightRailViewRef.current ?? RIGHT_DOCKABLE_IDS[0];
    if (fallback) setRightRailView(fallback as RailView);
  }

  function handleRailClick(view: RailView) {
    if (railView === view && sidebarOpen) {
      setSidebarOpen(false);
    } else {
      // A panel lives in one dock at a time, so the left dock reclaims it.
      if (rightRailView === view) setRightRailView(null);
      if (view !== railView) setSidebarEditing(false);
      if (view !== railView) setSettingsFullscreen(false);
      setRailView(view);
      setSidebarOpen(true);
    }
  }

  function editHostInManager(host: Host) {
    setSidebarOpen(true);
    setRailView("hosts");
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("host-manager:edit-host", { detail: host.id }),
      );
    }, 0);
  }

  const onSidebarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setSidebarDragging(true);
      const startX = e.clientX;
      const startW = sidebarWidth;
      function onMove(ev: MouseEvent) {
        setSidebarWidth(
          Math.max(160, Math.min(480, startW + ev.clientX - startX)),
        );
      }
      function onUp() {
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
      function onMove(ev: MouseEvent) {
        setRightSidebarWidth(
          Math.max(160, Math.min(480, startW - (ev.clientX - startX))),
        );
      }
      function onUp() {
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

  useEffect(() => {
    const id = resizeAllTerminals();
    return () => cancelAnimationFrame(id);
  }, [splitMode, sidebarWidth, sidebarOpen, rightSidebarWidth, rightRailView]);

  const isSplit =
    splitMode !== "none" &&
    tabs.some((tab) => tab.id === activeTabId && tab.type === "split-screen");

  // Move each tab's stable DOM node to the right container (pane or normal-view).
  // This is vanilla DOM so React's portal target never changes — changing the portal
  // target causes a remount which is exactly what we're trying to avoid.
  useEffect(() => {
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
      const isTerminal = tab.type === "terminal";
      const node = getTabNode(tab.id, isTerminal);
      const paneIdx = isSplit ? paneTabIds.indexOf(tab.id) : -1;
      const inPane = paneIdx !== -1;
      const paneEl = inPane ? paneContentEls[paneIdx] : null;
      const activeInline = !inPane && tab.id === activeTabId;

      if (inPane && paneEl) {
        if (node.parentElement !== paneEl) paneEl.appendChild(node);
        node.style.visibility = "visible";
        node.style.pointerEvents = "auto";
        node.style.display = "";
        node.style.zIndex = "";
      } else {
        if (node.parentElement !== normalView) normalView.appendChild(node);
        if (isTerminal) {
          node.style.display = "";
          node.style.visibility = activeInline ? "visible" : "hidden";
          node.style.pointerEvents = activeInline ? "auto" : "none";
          node.style.zIndex = activeInline ? "1" : "0";
        } else {
          node.style.visibility = "";
          node.style.pointerEvents = "";
          node.style.zIndex = activeInline ? "2" : "";
          node.style.display = activeInline ? "" : "none";
        }
      }
    }
  });

  const terminalTabs = tabs.filter((t) => t.type === "terminal");
  const topLevelTabs = tabs.filter((tab) => !tab.parentSplitTabId);

  function reorderTopLevelTabs(reordered: Tab[]) {
    setTabs((prev) => [
      ...reordered,
      ...prev.filter((tab) => tab.parentSplitTabId),
    ]);
  }

  // What history/snippets/ssh-tools should act on. Falls back to the remembered
  // terminal when the active tab isn't one, and drops it once it's closed.
  const targetTerminalTabId = terminalTabs.some((t) => t.id === activeTabId)
    ? activeTabId
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
  const renderSidebarPanels = (railView: RailView, owned = true) => (
    <Suspense fallback={<SidebarPanelFallback />}>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {owned && (
          <>
            <div
              className={`flex flex-col flex-1 min-h-0 ${railView === "hosts" ? "" : "hidden"}`}
            >
              <HostsPanel
                onOpenTab={(host, type) => {
                  connectHost(host, type);
                  if (isMobile) setSidebarOpen(false);
                }}
                onEditHost={editHostInManager}
                hostTree={realHostTree ?? undefined}
                loading={hostsLoading}
                onEditingChange={setSidebarEditing}
                active={railView === "hosts"}
              />
            </div>

            <div
              className={`flex flex-col flex-1 min-h-0 ${railView === "credentials" ? "" : "hidden"}`}
            >
              <CredentialsPanel
                onEditingChange={setSidebarEditing}
                active={railView === "credentials"}
              />
            </div>
          </>
        )}

        {railView === "termix-id" && (
          <div className="flex flex-col flex-1 min-h-0">
            <TermixIdPanel />
          </div>
        )}

        {railView === "serial" && (
          <SerialPanel
            onConnect={(config) => {
              openSerialTab(config);
              if (isMobile) setSidebarOpen(false);
            }}
          />
        )}

        {railView === "quick-connect" && (
          <QuickConnectPanel
            onConnect={(host, type) => {
              openTab(host, type);
              if (isMobile) setSidebarOpen(false);
            }}
          />
        )}

        {railView === "ssh-tools" && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <SshToolsPanel
              terminalTabs={terminalTabs}
              activeTabId={targetTerminalTabId}
            />
          </div>
        )}

        {railView === "snippets" && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <SnippetsPanel
              terminalTabs={terminalTabs}
              activeTabId={targetTerminalTabId}
              storageMode={
                userPrefs.storageMode === "cloud" ? "cloud" : "local"
              }
            />
          </div>
        )}

        {owned && (
          <div
            className={`flex flex-col flex-1 min-h-0 ${railView === "fleets" ? "" : "hidden"}`}
          >
            <FleetsPanel
              active={railView === "fleets"}
              onOpenFleetInventory={(fleetId) =>
                openSingletonTab(
                  "fleet-inventory",
                  undefined,
                  undefined,
                  fleetId,
                )
              }
            />
          </div>
        )}

        {railView === "history" && (
          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
            <HistoryPanel
              terminalTabs={terminalTabs}
              activeTabId={targetTerminalTabId}
            />
          </div>
        )}

        {railView === "split-screen" && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <SplitScreenPanel
              tabs={tabs.filter(
                (tab) =>
                  tab.type !== "split-screen" &&
                  (!tab.parentSplitTabId ||
                    tab.parentSplitTabId === activeTabId),
              )}
              splitMode={splitMode}
              setSplitMode={selectSplitMode}
              paneTabIds={paneTabIds}
              setPaneTabIds={setPaneTabIds}
              onAssignPane={assignPane}
            />
          </div>
        )}

        {railView === "workspaces" && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <WorkspacesPanel
              active={railView === "workspaces"}
              currentPayload={buildWorkspacePayload}
              onApplyWorkspace={applyWorkspace}
            />
          </div>
        )}

        {railView === "automations" && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <AutomationsPanel
              active={railView === "automations"}
              onEditingChange={setSidebarEditing}
            />
          </div>
        )}

        {railView === "ai" && (
          <div className="flex flex-col flex-1 min-h-0">
            <AiPanel
              activeTab={
                tabs.find((tab) => tab.id === activeTabId)?.type ?? null
              }
            />
          </div>
        )}

        {railView === "connections" && (
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
                const hostlessTypes: TabType[] = ["tunnel"];
                if (!host && !hostlessTypes.includes(record.tabType as TabType))
                  return;
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
              onJoinSharedSession={(session) => {
                if (!session.shareId) return;
                const existingHost = allHosts.find(
                  (h) => h.id === String(session.hostId),
                );
                const host: Host = existingHost ?? {
                  id: String(session.hostId),
                  name: session.hostName,
                  username: "",
                  ip: "",
                  port: 0,
                  folder: "",
                  online: false,
                  cpu: null,
                  ram: null,
                  lastAccess: new Date().toISOString(),
                  authType: "none",
                  enableTerminal: false,
                  enableCommandHistory: false,
                  enableTunnel: false,
                  enableFileManager: false,
                  enableDocker: false,
                  enableProxmox: false,
                  enableProxmoxStats: false,
                  enableTmuxMonitor: false,
                  enableTerminalToolbar: false,
                  enableSsh: false,
                  enableRdp: false,
                  enableVnc: false,
                  enableTelnet: false,
                  sshPort: 22,
                  rdpPort: 3389,
                  vncPort: 5900,
                  telnetPort: 23,
                  serverTunnels: [],
                  quickActions: [],
                };
                const instanceId =
                  typeof crypto.randomUUID === "function"
                    ? crypto.randomUUID()
                    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
                openTab(host, "terminal", {
                  instanceId,
                  restoredSessionId: null,
                  joinSharedSessionId: session.sessionId,
                  joinShareId: session.shareId,
                  savedLabel: t("connections.sharedSessionLabel", {
                    hostName: session.hostName,
                  }),
                });
                if (isMobile) setSidebarOpen(false);
              }}
            />
          </div>
        )}

        {railView === "session-logs" && (
          <div className="relative flex-1 min-h-0 flex flex-col">
            <SessionLogsPanel />
          </div>
        )}

        {railView === "user-profile" && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <UserProfilePanel
              username={username}
              onLogout={onLogout}
              userPrefs={userPrefs}
              onPrefsChange={(updates) =>
                setUserPrefs((current) => ({ ...current, ...updates }))
              }
              remoteSyncInitialServerUrl={remoteSyncInitialServerUrl}
            />
          </div>
        )}

        {railView === "admin-settings" && showAdminUI && (
          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
            <AdminSettingsPanel
              onEditingChange={setSidebarEditing}
              onOpenHostTab={(host) => {
                connectHost(host);
                if (isMobile) setSidebarOpen(false);
              }}
            />
          </div>
        )}

        {railView === "alerts" && (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <AlertsPanel />
          </div>
        )}
      </div>
    </Suspense>
  );

  const sidebarPanelContent = renderSidebarPanels(railView);

  // Sidebar header — shared
  const sidebarHeader = (
    <div className="flex flex-row items-center border-b border-border h-12.5 shrink-0">
      <span className="flex-1 min-w-0 whitespace-nowrap text-base font-bold tracking-tight text-foreground px-3">
        {sidebarTitle(railView)}
      </span>
      {!isMobile && PROMOTABLE_IDS.includes(railView) && (
        <>
          <Separator orientation="vertical" />
          <Button
            variant="ghost"
            size="icon"
            className="h-full w-12.5 border-y-0 border-r-0 border-border rounded-none text-muted-foreground hover:text-foreground"
            title={t("nav.openAsTab")}
            aria-label={t("nav.openAsTab")}
            onClick={() => openSingletonTab(railView as TabType)}
          >
            <SquareArrowOutUpRight className="size-3.5" />
          </Button>
        </>
      )}
      {!isMobile && RIGHT_DOCKABLE_IDS.includes(railView) && (
        <>
          <Separator orientation="vertical" />
          <Button
            variant="ghost"
            size="icon"
            className="h-full w-12.5 border-y-0 border-r-0 border-border rounded-none text-muted-foreground hover:text-foreground"
            title={t("nav.openInRightDock")}
            aria-label={t("nav.openInRightDock")}
            onClick={() => openInRightDock(railView)}
          >
            <PanelRight className="size-3.5" />
          </Button>
        </>
      )}
      {!isMobile && (
        <>
          <Separator orientation="vertical" />
          <Button
            variant="ghost"
            size="icon"
            className="h-full w-12.5 border-y-0 border-border rounded-none text-muted-foreground hover:text-foreground"
            title="Reset width"
            onClick={() => setSidebarWidth(291)}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </>
      )}
      {isSettingsView && (
        <>
          <Separator orientation="vertical" />
          <Button
            variant="ghost"
            size="icon"
            className="h-full w-12.5 rounded-none text-muted-foreground hover:text-foreground"
            title={
              settingsFullscreen
                ? t("newUi.sidebar.userProfile.exitFullscreenSettings")
                : t("newUi.sidebar.userProfile.openFullscreenSettings")
            }
            aria-label={
              settingsFullscreen
                ? t("newUi.sidebar.userProfile.exitFullscreenSettings")
                : t("newUi.sidebar.userProfile.openFullscreenSettings")
            }
            onClick={() => setSettingsFullscreen((value) => !value)}
          >
            {settingsFullscreen ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>
        </>
      )}
      <Separator orientation="vertical" />
      <Button
        variant="ghost"
        size="icon"
        className="h-full w-12.5 rounded-none text-muted-foreground hover:text-foreground"
        onClick={() => {
          setSettingsFullscreen(false);
          setSidebarOpen(false);
        }}
      >
        <ChevronLeft className="size-4" />
      </Button>
    </div>
  );

  const sidebarHint = !isMobile && (
    <MultiPanelHint
      canPromote={PROMOTABLE_IDS.includes(railView)}
      canRightDock={RIGHT_DOCKABLE_IDS.includes(railView)}
      onOpenAsTab={() => openSingletonTab(railView as TabType)}
      onOpenInRightDock={() => openInRightDock(railView)}
    />
  );

  return (
    <ServerStatusProvider isAuthenticated={!!username}>
      <div
        className="flex flex-col w-screen bg-background"
        style={{ height: "100dvh" }}
      >
        {isElectron() && (
          <>
            <RemoteSyncBanner
              onReconnect={() => {
                setRailView("user-profile");
                if (!sidebarOpen) setSidebarOpen(true);
              }}
            />
            <MigrationNoticeDialog
              onOpenRemoteSync={(url) => {
                setRemoteSyncInitialServerUrl(url);
                setRailView("user-profile");
                if (!sidebarOpen) setSidebarOpen(true);
              }}
            />
          </>
        )}
        <div className="flex flex-1 min-h-0">
          {/* Skinny icon rail — desktop only, hidden on mobile */}
          {!settingsFullscreen && (
            <AppRail
              railView={railView}
              sidebarOpen={sidebarOpen}
              splitMode={splitMode}
              username={username}
              isAdmin={showAdminUI}
              onRailClick={handleRailClick}
              onOpenTab={openSingletonTab}
              onOpenInRightDock={openInRightDock}
              onLogout={onLogout}
            />
          )}

          {/* Desktop: inline resizable sidebar */}
          {!isMobile && (
            <div
              className={`${settingsFullscreen ? "fixed inset-0 z-50" : "relative"} flex flex-col min-h-0 bg-sidebar shrink-0 overflow-hidden ${sidebarOpen ? `border-r transition-colors ${sidebarDragging ? "border-accent-brand/60" : "border-border"}` : ""}`}
              style={{
                width: settingsFullscreen
                  ? "100vw"
                  : sidebarOpen
                    ? sidebarEditing
                      ? 560
                      : sidebarWidth
                    : 0,
                transition: sidebarDragging ? "none" : "width 0.2s",
              }}
            >
              {sidebarHeader}
              {sidebarHint}
              {sidebarPanelContent}

              {sidebarOpen && !sidebarEditing && !settingsFullscreen && (
                <div
                  onMouseDown={onSidebarMouseDown}
                  className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-30 transition-colors ${sidebarDragging ? "bg-accent-brand/60" : "hover:bg-accent-brand/40"}`}
                />
              )}
            </div>
          )}

          {/* Mobile: sidebar as overlay sheet */}
          {isMobile && (
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetContent
                side="left"
                showCloseButton={false}
                className={`p-0 flex flex-col min-h-0 max-w-full bg-sidebar border-r border-border gap-0 ${settingsFullscreen ? "w-screen" : "w-[min(85vw,360px)]"}`}
                style={{ height: "100dvh" }}
              >
                {sidebarHeader}
                {sidebarPanelContent}
              </SheetContent>
            </Sheet>
          )}

          {/* Main content area */}
          <div
            inert={settingsFullscreen ? true : undefined}
            aria-hidden={settingsFullscreen || undefined}
            className={`relative flex flex-col flex-1 min-w-0 overflow-hidden transition-all duration-200 ${!isMobile && !sidebarOpen ? "pl-6" : ""}`}
          >
            {!isMobile && !sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                title="Open Sidebar"
                className="absolute left-0 top-0 bottom-0 z-20 flex items-center justify-center w-6 bg-sidebar border-r border-border text-muted-foreground hover:text-accent-brand hover:bg-accent-brand/5 transition-colors"
              >
                <ChevronRight className="size-3.5" />
              </button>
            )}
            <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
              <TabBar
                tabs={topLevelTabs}
                activeTabId={activeTabId}
                splitMode={splitMode}
                paneTabIds={paneTabIds}
                focusedPaneIndex={focusedPaneIndex}
                onSetActiveTab={setActiveTabId}
                onCloseTab={closeTab}
                onRefreshTab={refreshTab}
                onReorderTabs={reorderTopLevelTabs}
                onSplitTab={splitTabQuick}
                onAddToSplit={addTabToSplit}
                onRemoveFromSplit={removeTabFromSplit}
                onRenameTab={renameTab}
                onOpenFileManager={(tabId) => {
                  const targetTab = tabs.find((t) => t.id === tabId);
                  if (targetTab?.host) openTab(targetTab.host, "files");
                }}
                onOpenShare={openShareForTab}
                isAppFullscreen={isAppFullscreen}
                onToggleAppFullscreen={toggleAppFullscreen}
                rightDockOpen={rightRailView !== null}
                onToggleRightDock={isMobile ? undefined : toggleRightDock}
              />
              <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
                {/* Split view — always mounted when not mobile, hidden via CSS when inactive */}
                {!isMobile && (
                  <div
                    className="absolute inset-0"
                    style={{
                      display: isSplit ? "flex" : "none",
                      flexDirection: "column",
                    }}
                  >
                    <SplitView
                      tabs={tabs}
                      paneTabIds={paneTabIds}
                      splitMode={splitMode}
                      rowSizes={rowSizes}
                      rowColSizes={rowColSizes}
                      onRowSizesChange={setRowSizes}
                      onRowColSizesChange={setRowColSizes}
                      onReset={() => changeSplitMode(splitMode)}
                      focusedPaneIndex={focusedPaneIndex}
                      onTerminalResize={resizeAllTerminals}
                      onPaneContentRef={onPaneContentRef}
                      onPaneClick={setFocusedPaneIndex}
                      onAssignPane={assignPane}
                    />
                  </div>
                )}

                {/* Normal-view container. Tab nodes are appended here (or to pane elements)
                  by the DOM-placement effect above. React portals each tab's content
                  into its stable per-tab node so the component is never remounted.
                  When split is active, shown on top only if the active tab is not in a pane. */}
                <div
                  ref={normalViewRef}
                  className="absolute inset-0"
                  style={{
                    display: isSplit && !isMobile ? "none" : undefined,
                  }}
                >
                  {tabs.map((tab) => {
                    const tabNode = getTabNode(tab.id, tab.type === "terminal");
                    const paneIdx = isSplit ? paneTabIds.indexOf(tab.id) : -1;
                    const inPane = paneIdx !== -1;
                    const activeInline = !inPane && tab.id === activeTabId;
                    const isFocusedPane = inPane
                      ? paneIdx === (focusedPaneIndex ?? 0)
                      : activeInline;
                    return createPortal(
                      renderTabContent(
                        tab,
                        openSingletonTab,
                        openTab,
                        closeTab,
                        inPane || activeInline,
                        (host, filePath) =>
                          openTab(host, "files", {
                            instanceId:
                              typeof crypto.randomUUID === "function"
                                ? crypto.randomUUID()
                                : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
                            restoredSessionId: null,
                            initialFilePath: filePath,
                          }),
                        (host, path) =>
                          openTab(host, "files", {
                            instanceId:
                              typeof crypto.randomUUID === "function"
                                ? crypto.randomUUID()
                                : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
                            restoredSessionId: null,
                            initialPath: path,
                          }),
                        (host, path) =>
                          openTab(host, "terminal", {
                            instanceId:
                              typeof crypto.randomUUID === "function"
                                ? crypto.randomUUID()
                                : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
                            restoredSessionId: null,
                            initialFilePath: path,
                          }),
                        renameTab,
                        saveQuickConnectHost,
                        isFocusedPane,
                        {
                          terminalTabs,
                          targetTerminalTabId,
                          storageMode:
                            userPrefs.storageMode === "cloud"
                              ? "cloud"
                              : "local",
                        },
                      ),
                      tabNode,
                      tab.id,
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Bottom nav bar — mobile only */}
            <MobileBottomBar
              railView={railView}
              sidebarOpen={sidebarOpen}
              splitMode={splitMode}
              onRailClick={handleRailClick}
            />
          </div>

          {/* Right dock — desktop only, holds a second reference panel */}
          {!isMobile && rightRailView && !settingsFullscreen && (
            <div
              className={`relative flex flex-col min-h-0 bg-sidebar shrink-0 overflow-hidden border-l transition-colors ${rightSidebarDragging ? "border-accent-brand/60" : "border-border"}`}
              style={{
                width: rightSidebarWidth,
                transition: rightSidebarDragging ? "none" : "width 0.2s",
              }}
            >
              <div className="flex flex-row items-center border-b border-border h-12.5 shrink-0">
                <span className="flex-1 min-w-0 whitespace-nowrap text-base font-bold tracking-tight text-foreground px-3">
                  {sidebarTitle(rightRailView)}
                </span>
                <Separator orientation="vertical" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-full w-12.5 rounded-none text-muted-foreground hover:text-foreground"
                  title={t("nav.closeRightDock")}
                  aria-label={t("nav.closeRightDock")}
                  onClick={() => setRightRailView(null)}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>

              {renderSidebarPanels(rightRailView, false)}

              <div
                onMouseDown={onRightSidebarMouseDown}
                className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-30 transition-colors ${rightSidebarDragging ? "bg-accent-brand/60" : "hover:bg-accent-brand/40"}`}
              />
            </div>
          )}
        </div>
      </div>

      {commandPaletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            isOpen={commandPaletteOpen}
            setIsOpen={setCommandPaletteOpen}
            hosts={allHosts}
            terminalTabs={terminalTabs}
            activeTabId={activeTabId}
            onOpenPanel={(view) => handleRailClick(view as RailView)}
            onOpenTab={(type, label, pendingEvent) => {
              if (
                [
                  "dashboard",
                  "host-manager",
                  "user-profile",
                  "admin-settings",
                ].includes(type)
              ) {
                openSingletonTab(type, pendingEvent);
              } else if (type === "tmux_monitor") {
                // --- tmux-monitor --- singleton tab, optionally preselecting a host
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
      <TransferMonitor />
      <Suspense fallback={null}>
        <AlertManager userId={userId} loggedIn={!!username} />
      </Suspense>
      <OnboardingDialog
        open={showOnboarding}
        context={{
          hasHosts: onboardingHasHosts,
          aiGloballyEnabled: onboardingAiEnabled,
        }}
        onClose={() => setShowOnboarding(false)}
        onAddHost={() => {
          setShowOnboarding(false);
          setRailView("hosts");
          setSidebarOpen(true);
          window.dispatchEvent(new CustomEvent("host-manager:add-host"));
        }}
      />
      <DonationReminderModal
        open={showDonationModal && !showOnboarding}
        onDismiss={handleDismissDonationModal}
      />
    </ServerStatusProvider>
  );
}
