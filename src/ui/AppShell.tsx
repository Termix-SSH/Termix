import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Separator } from "@/components/separator";
import { Button } from "@/components/button";
import { Sheet, SheetContent } from "@/components/sheet";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { useState, useRef, useCallback, useEffect, createRef } from "react";
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
import { SplitView } from "@/shell/SplitView";
import { TabBar } from "@/shell/TabBar";
import type {
  Tab,
  TabType,
  Host,
  SplitMode,
  HostFolder,
} from "@/types/ui-types";
import { getSSHHosts } from "@/main-axios";
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
    enableRdp: h.connectionType === "rdp",
    enableVnc: h.connectionType === "vnc",
    enableTelnet: h.connectionType === "telnet",
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
import { renderTabContent } from "@/shell/tabUtils";

const DASHBOARD_TAB: Tab = {
  id: "dashboard",
  type: "dashboard",
  label: "Dashboard",
};

const SINGLETON_TAB_LABELS: Partial<Record<TabType, string>> = {
  "host-manager": "Host Manager",
  docker: "Docker",
  tunnel: "Tunnels",
  network_graph: "Network Graph",
};

// ─── AppShell ────────────────────────────────────────────────────────────────

export function AppShell({
  username,
  onLogout,
}: {
  username: string;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<Tab[]>([DASHBOARD_TAB]);
  const [activeTabId, setActiveTabId] = useState("dashboard");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [splitMode, setSplitMode] = useState<SplitMode>("none");
  const [paneTabIds, setPaneTabIds] = useState<(string | null)[]>(
    Array(6).fill(null),
  );
  const [realHostTree, setRealHostTree] = useState<HostFolder | null>(null);
  const [allHosts, setAllHosts] = useState<Host[]>([]);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [railView, setRailView] = useState<RailView>("hosts");
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [hostManagerExpanded, setHostManagerExpanded] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(266);
  const [sidebarDragging, setSidebarDragging] = useState(false);

  const isMobile = useIsMobile();

  // Close the sidebar when switching to mobile (it becomes a sheet overlay)
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const pendingHostManagerEditId = useRef<string | null>(null);
  const pendingHostManagerAction = useRef<"add-host" | "add-credential" | null>(
    null,
  );
  const lastShiftTime = useRef(0);
  const terminalRefs = useRef<Map<string, ReturnType<typeof createRef>>>(
    new Map(),
  );

  const sidebarTitle: Record<RailView, string> = {
    hosts: "Hosts",
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
    }
  }, []);

  useEffect(() => {
    loadHosts();
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
  }, [tabs, allHosts]);

  // ─── Tab management ──────────────────────────────────────────────────────

  function openTab(host: Host, type: TabType) {
    setTabs((prev) => {
      const same = prev.filter(
        (t) =>
          t.type === type && t.label.replace(/ \(\d+\)$/, "") === host.name,
      );
      if (same.length === 0) {
        const tabId = `${host.name}-${type}`;
        const ref = type === "terminal" ? createRef() : undefined;
        if (ref) terminalRefs.current.set(tabId, ref);
        const tab = {
          id: tabId,
          type,
          label: host.name,
          host,
          terminalRef: ref,
        };
        setActiveTabId(tab.id);
        return [...prev, tab];
      }
      const next = prev.map((t) =>
        t.id === same[0].id && !/\(\d+\)$/.test(t.label)
          ? { ...t, label: `${host.name} (1)`, host }
          : t,
      );
      const tabId = `${host.name}-${type}-${Date.now()}`;
      const ref = type === "terminal" ? createRef() : undefined;
      if (ref) terminalRefs.current.set(tabId, ref);
      const tab = {
        id: tabId,
        type,
        label: `${host.name} (${same.length + 1})`,
        host,
        terminalRef: ref,
      };
      setActiveTabId(tab.id);
      return [...next, tab];
    });
  }

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

  function openSingletonTab(type: TabType, pendingEvent?: string) {
    if (type === "host-manager") {
      if (pendingEvent === "host-manager:add-host")
        pendingHostManagerAction.current = "add-host";
      else if (pendingEvent === "host-manager:add-credential")
        pendingHostManagerAction.current = "add-credential";

      setHostManagerExpanded(true);
      setSidebarOpen(true);
      setRailView("hosts");

      if (pendingEvent) {
        // Use a small delay to ensure HostManager is mounted if it wasn't already,
        // and to allow the current render cycle to complete.
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent(pendingEvent));
        }, 0);
      }
      return;
    }
    if (type === "user-profile" || type === "admin-settings") {
      handleRailClick(type as RailView);
      return;
    }
    const id = type;
    setTabs((prev) => {
      if (prev.find((t) => t.id === id)) return prev;
      return [...prev, { id, type, label: SINGLETON_TAB_LABELS[type] ?? type }];
    });
    setActiveTabId(id);
  }

  function closeTab(id: string) {
    terminalRefs.current.delete(id);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (id === activeTabId) setActiveTabId(next[next.length - 1].id);
      return next;
    });
  }

  // ─── Rail / sidebar ──────────────────────────────────────────────────────

  function handleRailClick(view: RailView) {
    if (railView === view && sidebarOpen) {
      setSidebarOpen(false);
    } else {
      setRailView(view);
      setSidebarOpen(true);
    }
  }

  function editHostInManager(host: Host) {
    pendingHostManagerEditId.current = host.id;
    setHostManagerExpanded(true);
    setSidebarOpen(true);
    setRailView("hosts");
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

  const activeTab = tabs.find((t) => t.id === activeTabId)!;
  const isSplit = splitMode !== "none";
  const terminalTabs = tabs.filter((t) => t.type === "terminal");

  // Sidebar panel content — shared between desktop inline sidebar and mobile sheet
  const sidebarPanelContent = (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {railView === "hosts" && (
        <HostsPanel
          expanded={hostManagerExpanded}
          onExpand={() => setHostManagerExpanded(true)}
          onCollapse={() => {
            setHostManagerExpanded(false);
            loadHosts();
          }}
          pendingEditId={pendingHostManagerEditId}
          pendingAction={pendingHostManagerAction}
          onOpenTab={(host, type) => {
            connectHost(host, type);
            if (isMobile) setSidebarOpen(false);
          }}
          onEditHost={editHostInManager}
          hostTree={realHostTree ?? undefined}
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

      {railView === "admin-settings" && (
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
      {!hostManagerExpanded && !isMobile && (
        <>
          <Separator orientation="vertical" />
          <Button
            variant="ghost"
            size="icon"
            className="h-full w-12.5 rounded-none text-muted-foreground hover:text-foreground"
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
        onClick={() => {
          setSidebarOpen(false);
          setHostManagerExpanded(false);
        }}
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
          profileDropdownOpen={profileDropdownOpen}
          onProfileDropdownChange={setProfileDropdownOpen}
          onRailClick={handleRailClick}
          onLogout={onLogout}
        />

        {/* Desktop: inline resizable sidebar */}
        {!isMobile && (
          <div
            className={`relative flex flex-col bg-sidebar shrink-0 overflow-hidden ${sidebarOpen ? `border-r transition-colors ${sidebarDragging ? "border-accent-brand/60" : "border-border"}` : ""}`}
            style={{
              width: sidebarOpen
                ? hostManagerExpanded && railView === "hosts"
                  ? 720
                  : sidebarWidth
                : 0,
              transition: sidebarDragging ? "none" : "width 0.2s",
            }}
          >
            {sidebarHeader}
            {sidebarPanelContent}

            {sidebarOpen && !(hostManagerExpanded && railView === "hosts") && (
              <div
                onMouseDown={onSidebarMouseDown}
                className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-30 transition-colors ${sidebarDragging ? "bg-accent-brand/60" : "hover:bg-accent-brand/40"}`}
              />
            )}
          </div>
        )}

        {/* Mobile: sidebar as overlay sheet */}
        {isMobile && (
          <Sheet
            open={sidebarOpen}
            onOpenChange={(open) => {
              setSidebarOpen(open);
              if (!open) setHostManagerExpanded(false);
            }}
          >
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
              onReorderTabs={setTabs}
            />
            <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
              {isSplit && !isMobile ? (
                <SplitView
                  tabs={tabs}
                  paneTabIds={paneTabIds}
                  splitMode={splitMode}
                  onOpenSingletonTab={openSingletonTab}
                  onOpenTab={openTab}
                />
              ) : (
                <>
                  {/* Terminal tabs: always in DOM, absolutely positioned so xterm always has real dimensions */}
                  {tabs
                    .filter((tab) => tab.type === "terminal")
                    .map((tab) => {
                      const visible = tab.id === activeTabId;
                      return (
                        <div
                          key={tab.id}
                          className="absolute inset-0 overflow-hidden"
                          style={{
                            visibility: visible ? "visible" : "hidden",
                            pointerEvents: visible ? "auto" : "none",
                            zIndex: visible ? 1 : 0,
                          }}
                        >
                          {renderTabContent(
                            tab,
                            openSingletonTab,
                            openTab,
                            closeTab,
                            visible,
                          )}
                        </div>
                      );
                    })}
                  {/* Non-terminal tabs: display:none when inactive */}
                  {tabs
                    .filter((tab) => tab.type !== "terminal")
                    .map((tab) => {
                      const visible = tab.id === activeTabId;
                      return (
                        <div
                          key={tab.id}
                          className="flex flex-col flex-1 min-h-0 overflow-hidden"
                          style={{ display: visible ? undefined : "none" }}
                        >
                          {renderTabContent(
                            tab,
                            openSingletonTab,
                            openTab,
                            closeTab,
                            visible,
                          )}
                        </div>
                      );
                    })}
                </>
              )}
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
