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
} from "@/types/ui-types";
import { getSSHHosts, getUserInfo } from "@/main-axios";
import { dbHealthMonitor } from "@/lib/db-health-monitor";
import type { SSHHostWithStatus } from "@/main-axios";

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
    enableFileManager: h.enableFileManager ?? false,
    enableDocker: h.enableDocker ?? false,
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
    serverTunnels: [],
    defaultPath: h.defaultPath,
    terminalConfig: h.terminalConfig as Host["terminalConfig"],
    useSocks5: h.useSocks5,
    socks5Host: h.socks5Host,
    socks5Port: h.socks5Port,
    socks5Username: h.socks5Username,
    socks5Password: h.socks5Password,
  };
}

function buildHostTree(hosts: SSHHostWithStatus[]): HostFolder {
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
        const folder: HostFolder = { name: part, children: [] };
        folderMap.set(accumulated, folder);
        current.children.push(folder);
      }
      current = folderMap.get(accumulated)!;
    }
    return current;
  };
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
}: {
  username: string;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "dashboard", type: "dashboard", label: t("nav.dashboard") },
  ]);
  const [activeTabId, setActiveTabId] = useState("dashboard");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [splitMode, setSplitMode] = useState<SplitMode>("none");
  const [paneTabIds, setPaneTabIds] = useState<(string | null)[]>(
    Array(6).fill(null),
  );
  const [realHostTree, setRealHostTree] = useState<HostFolder | null>(null);
  const [hostsLoading, setHostsLoading] = useState(true);
  const [allHosts, setAllHosts] = useState<Host[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [railView, setRailView] = useState<RailView>("hosts");
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(266);
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [sidebarEditing, setSidebarEditing] = useState(false);

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
  const terminalRefs = useRef<Map<string, ReturnType<typeof createRef>>>(
    new Map(),
  );
  const [paneContentEls, setPaneContentEls] = useState<
    (HTMLDivElement | null)[]
  >(Array(6).fill(null));

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
    "split-screen": "Split Screen",
    "user-profile": "User Profile",
    "admin-settings": "Admin Settings",
  };

  // Double-shift opens command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "ShiftLeft") {
        const now = Date.now();
        if (now - lastShiftTime.current < 300)
          setCommandPaletteOpen((prev) => !prev);
        lastShiftTime.current = now;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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

  // Load real hosts from API
  const loadHosts = useCallback(async () => {
    try {
      const raw = await getSSHHosts();
      const converted = raw.map(sshHostToHost);
      setAllHosts(converted);
      setRealHostTree(buildHostTree(raw));
    } catch {
      // Keep empty state on error
    } finally {
      setHostsLoading(false);
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

  // ─── Tab management ──────────────────────────────────────────────────────

  const openTab = useCallback(function openTab(host: Host, type: TabType) {
    const tabId = `${host.name}-${type}-${Date.now()}`;
    const ref = type === "terminal" ? createRef() : undefined;
    if (ref) terminalRefs.current.set(tabId, ref);

    setTabs((prev) => {
      const same = prev.filter(
        (t) =>
          t.type === type && t.label.replace(/ \(\d+\)$/, "") === host.name,
      );
      const label =
        same.length === 0 ? host.name : `${host.name} (${same.length + 1})`;

      // Retrofit the first duplicate's label to "(1)" if needed
      const next =
        same.length === 1 && !/\(\d+\)$/.test(same[0].label)
          ? prev.map((t) =>
              t.id === same[0].id ? { ...t, label: `${host.name} (1)` } : t,
            )
          : prev;

      return [...next, { id: tabId, type, label, host, terminalRef: ref }];
    });
    setActiveTabId(tabId);
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
    openTab(host, type);
  }

  const openSingletonTab = useCallback(
    function openSingletonTab(type: TabType, pendingEvent?: string) {
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
      setTabs((prev) => {
        if (prev.find((t) => t.id === id)) return prev;
        const singletonLabels: Partial<Record<TabType, string>> = {
          "host-manager": t("nav.hostManager"),
          docker: t("nav.docker"),
          tunnel: t("nav.tunnels"),
          network_graph: t("nav.networkGraph"),
        };
        return [...prev, { id, type, label: singletonLabels[type] ?? type }];
      });
      setActiveTabId(id);
    },
    [t],
  );

  const SESSION_TAB_TYPES: TabType[] = ["terminal", "rdp", "vnc", "telnet"];

  function doCloseTab(id: string) {
    terminalRefs.current.delete(id);
    if (id === activeTabId) {
      const remaining = tabs.filter((t) => t.id !== id);
      setActiveTabId(
        remaining.length > 0 ? remaining[remaining.length - 1].id : "dashboard",
      );
    }
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0)
        return [
          { id: "dashboard", type: "dashboard", label: t("nav.dashboard") },
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
        const ref = tab.terminalRef.current as any;
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
          node.style.zIndex = activeInline && !isSplit ? "1" : "0";
        } else {
          node.style.visibility = "";
          node.style.pointerEvents = "";
          node.style.zIndex = activeInline ? "2" : "";
          node.style.display = activeInline ? "" : "none";
        }
      }
    }
  });

  const activeTab = tabs.find((t) => t.id === activeTabId)!;
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
          />
        </div>
      )}

      {railView === "user-profile" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <UserProfilePanel username={username} onLogout={onLogout} />
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
            onClick={() => setSidebarWidth(266)}
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
          profileDropdownOpen={profileDropdownOpen}
          onProfileDropdownChange={setProfileDropdownOpen}
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
              onSetActiveTab={setActiveTabId}
              onCloseTab={closeTab}
              onRefreshTab={refreshTab}
              onReorderTabs={setTabs}
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
                    onTerminalResize={resizeAllTerminals}
                    onPaneContentRef={onPaneContentRef}
                  />
                </div>
              )}

              {/* Normal-view container. Tab nodes are appended here (or to pane elements)
                  by the DOM-placement effect above. React portals each tab's content
                  into its stable per-tab node so the component is never remounted.
                  Hidden when split is active — pane-assigned nodes escape via vanilla DOM
                  appendChild to paneEl, so hiding this doesn't affect them. */}
              <div
                ref={normalViewRef}
                className="absolute inset-0"
                style={{ display: isSplit && !isMobile ? "none" : undefined }}
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
          } else if (label) {
            const host = allHosts.find((h) => h.name === label);
            if (host) openTab(host, type);
          }
        }}
      />
    </>
  );
}
