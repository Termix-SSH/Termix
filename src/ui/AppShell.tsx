/* eslint-disable react-refresh/only-export-components */
/* eslint-disable react-hooks/exhaustive-deps */
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Separator } from "@/components/separator";
import { Button } from "@/components/button";
import { Sheet, SheetContent } from "@/components/sheet";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { useState, useRef, useCallback, useEffect, createRef } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileBottomBar } from "@/shell/MobileBottomBar";
import { CommandPalette } from "@/shell/CommandPalette";
import { AppRail } from "@/sidebar/AppRail";
import type { RailView } from "@/sidebar/AppRail";
import { HostsPanel } from "@/sidebar/HostsPanel";
import { QuickConnectPanel } from "@/sidebar/QuickConnectPanel";
import { SshToolsPanel } from "@/sidebar/SshToolsPanel";
import { SnippetsPanel } from "@/sidebar/SnippetsPanel";
import { HistoryPanel } from "@/sidebar/HistoryPanel";
import { SessionLogsPanel } from "@/sidebar/SessionLogsPanel";
import { SplitScreenPanel } from "@/sidebar/SplitScreenPanel";
import { UserProfilePanel } from "@/sidebar/UserProfilePanel";
import { AdminSettingsPanel } from "@/sidebar/AdminSettingsPanel";
import { CredentialsPanel } from "@/sidebar/CredentialsPanel";
import { SplitView } from "@/shell/SplitView";
import { renderTabContent } from "@/shell/tabUtils";
import { TabBar } from "@/shell/TabBar";
import type {
  Tab,
  TabType,
  Host,
  SplitMode,
  HostFolder,
  ThemeId,
  FontSizeId,
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
  getActiveSessions,
  getUserPreferences,
  type UserPreferences,
  type OpenTabRecord,
} from "@/main-axios";
import { dbHealthMonitor } from "@/lib/db-health-monitor";
import type { SSHHostWithStatus } from "@/main-axios";
import { ConnectionsPanel } from "@/sidebar/ConnectionsPanel";
import { TransferMonitor } from "@/features/file-manager/TransferMonitor.tsx";

function sshHostToHost(h: SSHHostWithStatus): Host {
  return {
    id: String(h.id),
    name: h.name,
    username: h.username,
    ip: h.ip,
    port: h.port,
    folder: h.folder ?? "",
    online: h.status === "online",
    cpu: 0,
    ram: 0,
    lastAccess: "",
    tags: h.tags ?? [],
    authType: h.authType,
    password: h.password,
    key: typeof h.key === "string" ? h.key : undefined,
    keyPassword: h.keyPassword,
    keyType: h.keyType,
    credentialId: h.credentialId != null ? String(h.credentialId) : undefined,
    notes: h.notes,
    pin: h.pin ?? false,
    macAddress: h.macAddress,
    enableSsh: h.enableSsh ?? (h.connectionType === "ssh" || !h.connectionType),
    enableTerminal: h.enableTerminal ?? true,
    enableTunnel: h.enableTunnel ?? false,
    enableFileManager: h.enableFileManager ?? true,
    enableDocker: h.enableDocker ?? false,
    enableProxmox: h.enableProxmox ?? false,
    enableTmuxMonitor: h.enableTmuxMonitor ?? false, // --- tmux-monitor ---
    proxmoxConfig: (h.proxmoxConfig as Host["proxmoxConfig"]) ?? null,
    enableRdp: h.enableRdp ?? h.connectionType === "rdp",
    enableVnc: h.enableVnc ?? h.connectionType === "vnc",
    enableTelnet: h.enableTelnet ?? h.connectionType === "telnet",
    sshPort: h.port,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
    quickActions: (h.quickActions ?? []).map((a) => ({
      name: a.name,
      snippetId: String(a.snippetId),
    })),
    jumpHosts: (h.jumpHosts ?? []).map((j) => ({
      hostId: String(j.hostId),
    })),
    serverTunnels: [],
    defaultPath: h.defaultPath,
    terminalConfig: h.terminalConfig as Host["terminalConfig"],
    useSocks5: h.useSocks5,
    socks5Host: h.socks5Host,
    socks5Port: h.socks5Port,
    socks5Username: h.socks5Username,
    socks5Password: h.socks5Password,
    socks5ProxyChain: h.socks5ProxyChain ?? [],
    statsConfig: (typeof h.statsConfig === "string"
      ? JSON.parse(h.statsConfig)
      : h.statsConfig) as Host["statsConfig"],
  };
}

function buildHostTree(
  hosts: SSHHostWithStatus[],
  folderMeta?: Map<string, { color?: string; icon?: string }>,
): HostFolder {
  const root: HostFolder = { name: "root", children: [] };
  const folderMap = new Map<string, HostFolder>();
  const getOrCreateFolder = (path: string): HostFolder => {
    if (folderMap.has(path)) return folderMap.get(path)!;
    const parts = path.split(" / ");
    let current = root;
    let accumulated = "";
    for (const part of parts) {
      accumulated = accumulated ? `${accumulated} / ${part}` : part;
      if (!folderMap.has(accumulated)) {
        const meta = folderMeta?.get(accumulated);
        const folder: HostFolder = {
          name: part,
          path: accumulated,
          color: meta?.color,
          icon: meta?.icon,
          children: [],
        };
        folderMap.set(accumulated, folder);
        current.children.push(folder);
      }
      current = folderMap.get(accumulated)!;
    }
    return current;
  };
  // Surface empty folders (created but with no hosts yet) so they stay visible.
  if (folderMeta) {
    for (const path of folderMeta.keys()) getOrCreateFolder(path);
  }
  for (const h of hosts) {
    const host = sshHostToHost(h);
    if (h.folder) {
      getOrCreateFolder(h.folder).children.push(host);
    } else {
      root.children.push(host);
    }
  }
  return root;
}
export { tabIcon, renderTabContent } from "@/shell/tabUtils";

// ─── AppShell ────────────────────────────────────────────────────────────────

export function AppShell({
  username,
  onLogout,
  onChangeServer,
}: {
  username: string;
  onLogout: () => void;
  onChangeServer?: () => void;
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
  const [splitMode, setSplitMode] = useState<SplitMode>(
    () => (localStorage.getItem("termix_splitMode") as SplitMode) ?? "none",
  );
  const [paneTabIds, setPaneTabIds] = useState<(string | null)[]>(
    () =>
      JSON.parse(localStorage.getItem("termix_paneTabIds") ?? "null") ??
      Array(6).fill(null),
  );
  useEffect(() => {
    paneTabIdsRef.current = paneTabIds;
  }, [paneTabIds]);
  const [focusedPaneIndex, setFocusedPaneIndex] = useState<number | null>(null);
  const [realHostTree, setRealHostTree] = useState<HostFolder | null>(null);
  const [hostsLoading, setHostsLoading] = useState(true);
  const [allHosts, setAllHosts] = useState<Host[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [backgroundTabRecords, setBackgroundTabRecords] = useState<
    OpenTabRecord[]
  >([]);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [railView, setRailView] = useState<RailView>("hosts");
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("termix_sidebarWidth");
    return saved ? parseInt(saved, 10) : 291;
  });
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [sidebarEditing, setSidebarEditing] = useState(false);

  useEffect(() => {
    localStorage.setItem("termix_sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem("termix_splitMode", splitMode);
  }, [splitMode]);

  useEffect(() => {
    localStorage.setItem("termix_paneTabIds", JSON.stringify(paneTabIds));
  }, [paneTabIds]);

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
      .then((info) => setIsAdmin(info.is_admin))
      .catch(() => setIsAdmin(false));
  }, []);

  const lastShiftTime = useRef(0);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
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

  const sidebarTitle: Record<RailView, string> = {
    hosts: "Hosts",
    credentials: "Credentials",
    "quick-connect": "Quick Connect",
    "ssh-tools": "SSH Tools",
    snippets: "Snippets",
    history: "History",
    "session-logs": t("nav.sessionLogs"),
    "split-screen": "Split Screen",
    connections: t("nav.connections"),
    "user-profile": "User Profile",
    "admin-settings": "Admin Settings",
  };

  // Double-shift opens command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "ShiftLeft" && !e.repeat) {
        const now = Date.now();
        if (now - lastShiftTime.current < 300 && commandPaletteShortcutEnabled)
          setCommandPaletteOpen((prev) => !prev);
        lastShiftTime.current = now;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteShortcutEnabled]);

  // Split-screen and tab navigation hotkeys
  // Also registered in globalShortcutHandler so xterm can invoke directly
  // without going through synthetic DOM events (which are unreliable).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+\ — toggle 2-way split (side by side)
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === "Backslash") {
        e.preventDefault();
        if (splitModeRef.current !== "none") {
          splitModeRef.current = "none";
          setSplitMode("none");
          setPaneTabIds(Array(6).fill(null));
        } else {
          const mode = "2-way";
          splitModeRef.current = mode;
          const currentTabs = tabsRef.current;
          const currentActiveId = activeTabIdRef.current;
          const count = PANE_COUNTS[mode];
          const next: (string | null)[] = Array(6).fill(null);
          next[0] = currentActiveId;
          let slot = 1;
          for (const tab of currentTabs) {
            if (slot >= count) break;
            if (tab.id !== currentActiveId && tab.type !== "dashboard") {
              next[slot] = tab.id;
              slot++;
            }
          }
          setSplitMode(mode);
          setPaneTabIds(next);
        }
        return;
      }

      // Ctrl+Shift+- — toggle 3-way-horizontal split (top/bottom)
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === "Minus") {
        e.preventDefault();
        if (splitModeRef.current !== "none") {
          splitModeRef.current = "none";
          setSplitMode("none");
          setPaneTabIds(Array(6).fill(null));
        } else {
          const mode = "3-way-horizontal";
          splitModeRef.current = mode;
          const currentTabs = tabsRef.current;
          const currentActiveId = activeTabIdRef.current;
          const count = PANE_COUNTS[mode];
          const next: (string | null)[] = Array(6).fill(null);
          next[0] = currentActiveId;
          let slot = 1;
          for (const tab of currentTabs) {
            if (slot >= count) break;
            if (tab.id !== currentActiveId && tab.type !== "dashboard") {
              next[slot] = tab.id;
              slot++;
            }
          }
          setSplitMode(mode);
          setPaneTabIds(next);
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
                | import("@/features/terminal/Terminal").TerminalHandle
                | null
            )?.focus();
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
          if (prefs.language && prefs.language !== i18n.language) {
            localStorage.setItem("i18nextLng", prefs.language);
            void i18n.changeLanguage(prefs.language);
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
          if (prefs.pinAppRail !== null && prefs.pinAppRail !== undefined)
            localStorage.setItem("pinAppRail", String(prefs.pinAppRail));
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
      const folderMeta = new Map<string, { color?: string; icon?: string }>();
      for (const f of folders) {
        folderMeta.set(f.name, {
          color: f.color ?? undefined,
          icon: f.icon ?? undefined,
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
    window.addEventListener("termix:hosts-changed", loadHosts);
    return () => window.removeEventListener("termix:hosts-changed", loadHosts);
  }, [loadHosts]);

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
                terminalRef:
                  saved.tabType === "terminal" ? createRef() : undefined,
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

  // ─── Tab management ──────────────────────────────────────────────────────

  const openTab = useCallback(function openTab(
    host: Host,
    type: TabType,
    restore?: {
      instanceId: string;
      restoredSessionId: string | null;
      savedLabel?: string;
      initialFilePath?: string;
    },
  ) {
    const tabId = `${host.name}-${type}-${Date.now()}`;
    const instanceId =
      restore?.instanceId ??
      (typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
    const openedAt = Date.now();
    const ref = type === "terminal" ? createRef() : undefined;
    if (ref) terminalRefs.current.set(tabId, ref);

    let finalLabel = host.name;
    const savedLabel = restore?.savedLabel;
    const initialFilePath = restore?.initialFilePath;
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
            initialFilePath,
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
          initialFilePath,
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
  }, []);

  function connectHost(host: Host, preferredType?: TabType) {
    const type: TabType =
      preferredType ??
      (host.enableSsh
        ? "terminal"
        : host.enableRdp
          ? "rdp"
          : host.enableVnc
            ? "vnc"
            : host.enableTelnet
              ? "telnet"
              : "terminal");
    // --- tmux-monitor --- singleton tab, not a per-host tab
    if (type === "tmux_monitor") {
      openSingletonTab(type, undefined, host);
      return;
    }
    openTab(host, type);
  }

  const openSingletonTab = useCallback(
    // --- tmux-monitor --- (added optional `host` so tmux_monitor can open
    // with a preselected host; existing callers are unaffected)
    function openSingletonTab(
      type: TabType,
      pendingEvent?: string,
      host?: Host,
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
      };
      setTabs((prev) => {
        const existing = prev.find((t) => t.id === id);
        if (existing) {
          // --- tmux-monitor --- refocusing with a host preselects it
          if (!host) return prev;
          return prev.map((t) => (t.id === id ? { ...t, host } : t));
        }
        return [
          ...prev,
          {
            id,
            instanceId: id,
            type,
            label: singletonLabels[type] ?? type,
            openedAt: Date.now(),
            ...(host ? { host } : {}), // --- tmux-monitor ---
          },
        ];
      });
      setActiveTabId(id);
      if (PERSISTENT_TAB_TYPES.includes(type)) {
        addOpenTab({
          id,
          tabType: type,
          hostId: null,
          label: singletonLabels[type] ?? type,
          tabOrder: 0,
        }).catch(() => {});
      }
    },
    [t],
  );

  const SESSION_TAB_TYPES: TabType[] = ["terminal", "rdp", "vnc", "telnet"];

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
      const remaining = tabs.filter((t) => t.id !== id);
      setActiveTabId(
        remaining.length > 0 ? remaining[remaining.length - 1].id : "dashboard",
      );
    }
    setPaneTabIds((prev) => prev.map((p) => (p === id ? null : p)));
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
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

  function closeTab(id: string) {
    const tab = tabs.find((t) => t.id === id);
    const confirmEnabled = localStorage.getItem("confirmTabClose") === "true";
    if (tab && SESSION_TAB_TYPES.includes(tab.type) && confirmEnabled) {
      toast(t("nav.confirmClose"), {
        duration: 5000,
        action: {
          label: t("nav.close"),
          onClick: () => doCloseTab(id),
        },
        cancel: {
          label: t("nav.cancel"),
          onClick: () => {},
        },
      });
      return;
    }
    doCloseTab(id);
  }

  function renameTab(tabId: string, newLabel: string) {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, customLabel: newLabel, label: newLabel } : t,
      ),
    );
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.instanceId) {
      patchOpenTab(tab.instanceId, { label: newLabel }).catch(() => {});
    }
  }

  function splitTabQuick(tabId: string, mode: SplitMode) {
    setSplitMode(mode);
    setPaneTabIds(() => {
      const count = PANE_COUNTS[mode];
      const next: (string | null)[] = Array(6).fill(null);
      next[0] = tabId;
      // Fill remaining panes with other non-dashboard tabs in order
      let slot = 1;
      for (const tab of tabs) {
        if (slot >= count) break;
        if (tab.id !== tabId && tab.type !== "dashboard") {
          next[slot] = tab.id;
          slot++;
        }
      }
      return next;
    });
  }

  function addTabToSplit(tabId: string) {
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

  function assignPane(paneIndex: number, tabId: string) {
    setPaneTabIds((prev) => {
      const next = prev.map((p) => (p === tabId ? null : p));
      next[paneIndex] = tabId;
      return next;
    });
  }

  // ─── Rail / sidebar ──────────────────────────────────────────────────────

  function handleRailClick(view: RailView) {
    if (railView === view && sidebarOpen) {
      setSidebarOpen(false);
    } else {
      if (view !== railView) setSidebarEditing(false);
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
  }, [splitMode, sidebarWidth, sidebarOpen]);

  const isSplit = splitMode !== "none";

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

  // Sidebar panel content — shared between desktop inline sidebar and mobile sheet
  const sidebarPanelContent = (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
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
            activeTabId={activeTabId}
          />
        </div>
      )}

      {railView === "snippets" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SnippetsPanel
            terminalTabs={terminalTabs}
            activeTabId={activeTabId}
          />
        </div>
      )}

      {railView === "history" && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
          <HistoryPanel terminalTabs={terminalTabs} activeTabId={activeTabId} />
        </div>
      )}

      {railView === "split-screen" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SplitScreenPanel
            tabs={tabs}
            splitMode={splitMode}
            setSplitMode={setSplitMode}
            paneTabIds={paneTabIds}
            setPaneTabIds={setPaneTabIds}
            onAssignPane={assignPane}
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
            onChangeServer={onChangeServer}
            userPrefs={userPrefs}
            onPrefsChange={setUserPrefs}
          />
        </div>
      )}

      {railView === "admin-settings" && isAdmin && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <AdminSettingsPanel />
        </div>
      )}
    </div>
  );

  // Sidebar header — shared
  const sidebarHeader = (
    <div className="flex flex-row items-center border-b border-border h-12.5 shrink-0">
      <span className="flex-1 text-base font-bold tracking-tight text-foreground px-3">
        {sidebarTitle[railView]}
      </span>
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
            <Maximize2 className="size-3.5" />
          </Button>
        </>
      )}
      <Separator orientation="vertical" />
      <Button
        variant="ghost"
        size="icon"
        className="h-full w-12.5 rounded-none text-muted-foreground hover:text-foreground"
        onClick={() => setSidebarOpen(false)}
      >
        <ChevronLeft className="size-4" />
      </Button>
    </div>
  );

  return (
    <>
      <div className="flex w-screen bg-background" style={{ height: "100dvh" }}>
        {/* Skinny icon rail — desktop only, hidden on mobile */}
        <AppRail
          railView={railView}
          sidebarOpen={sidebarOpen}
          splitMode={splitMode}
          username={username}
          isAdmin={isAdmin}
          onRailClick={handleRailClick}
          onOpenTab={openSingletonTab}
          onLogout={onLogout}
        />

        {/* Desktop: inline resizable sidebar */}
        {!isMobile && (
          <div
            className={`relative flex flex-col bg-sidebar shrink-0 overflow-hidden ${sidebarOpen ? `border-r transition-colors ${sidebarDragging ? "border-accent-brand/60" : "border-border"}` : ""}`}
            style={{
              width: sidebarOpen ? (sidebarEditing ? 560 : sidebarWidth) : 0,
              transition: sidebarDragging ? "none" : "width 0.2s",
            }}
          >
            {sidebarHeader}
            {sidebarPanelContent}

            {sidebarOpen && !sidebarEditing && (
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
              className="p-0 flex flex-col w-[min(85vw,360px)] max-w-full bg-sidebar border-r border-border gap-0"
              style={{ height: "100dvh" }}
            >
              {sidebarHeader}
              {sidebarPanelContent}
            </SheetContent>
          </Sheet>
        )}

        {/* Main content area */}
        <div
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
              tabs={tabs}
              activeTabId={activeTabId}
              splitMode={splitMode}
              paneTabIds={paneTabIds}
              focusedPaneIndex={focusedPaneIndex}
              onSetActiveTab={setActiveTabId}
              onCloseTab={closeTab}
              onRefreshTab={refreshTab}
              onReorderTabs={setTabs}
              onSplitTab={splitTabQuick}
              onAddToSplit={addTabToSplit}
              onRemoveFromSplit={removeTabFromSplit}
              onRenameTab={renameTab}
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
                  display:
                    isSplit && !isMobile && paneTabIds.includes(activeTabId)
                      ? "none"
                      : undefined,
                  zIndex:
                    isSplit && !paneTabIds.includes(activeTabId)
                      ? 10
                      : undefined,
                }}
              >
                {tabs.map((tab) => {
                  const tabNode = getTabNode(tab.id, tab.type === "terminal");
                  const paneIdx = isSplit ? paneTabIds.indexOf(tab.id) : -1;
                  const inPane = paneIdx !== -1;
                  const activeInline = !inPane && tab.id === activeTabId;
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
                      (host, path) => openTab(host, "files"),
                      renameTab,
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
      </div>

      <CommandPalette
        isOpen={commandPaletteOpen}
        setIsOpen={setCommandPaletteOpen}
        hosts={allHosts}
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
      <TransferMonitor />
    </>
  );
}
