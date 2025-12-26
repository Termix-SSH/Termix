import React, { useState } from "react";
import {
  ChevronUp,
  User2,
  HardDrive,
  Menu,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { isElectron, logoutUser } from "@/ui/main-axios.ts";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
  SidebarHeader,
} from "@/components/ui/sidebar.tsx";

import { Separator } from "@/components/ui/separator.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@radix-ui/react-dropdown-menu";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { FolderCard } from "@/ui/desktop/navigation/hosts/FolderCard.tsx";
import { getSSHHosts, getSSHFolders } from "@/ui/main-axios.ts";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import type { SSHFolder } from "@/types/index.ts";

interface SSHHost {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  folder: string;
  tags: string[];
  pin: boolean;
  authType: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  enableTerminal: boolean;
  enableTunnel: boolean;
  enableFileManager: boolean;
  defaultPath: string;
  tunnelConnections: unknown[];
  createdAt: string;
  updatedAt: string;
}

interface SidebarProps {
  disabled?: boolean;
  isAdmin?: boolean;
  username?: string | null;
  children?: React.ReactNode;
  onLogout?: () => void;
}

async function handleLogout() {
  try {
    await logoutUser();

    if (isElectron()) {
      localStorage.removeItem("jwt");
    }

    window.location.reload();
  } catch (error) {
    console.error("Logout failed:", error);
    window.location.reload();
  }
}

export function LeftSidebar({
  disabled,
  isAdmin,
  username,
  children,
  onLogout,
}: SidebarProps): React.ReactElement {
  const { t } = useTranslation();

  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem("leftSidebarOpen");
    return saved !== null ? JSON.parse(saved) : true;
  });

  const {
    tabs: tabList,
    addTab,
    setCurrentTab,
    allSplitScreenTab,
    updateHostConfig,
  } = useTabs() as {
    tabs: Array<{ id: number; type: string; [key: string]: unknown }>;
    addTab: (tab: { type: string; [key: string]: unknown }) => number;
    setCurrentTab: (id: number) => void;
    allSplitScreenTab: number[];
    updateHostConfig: (id: number, config: unknown) => void;
  };
  const isSplitScreenActive =
    Array.isArray(allSplitScreenTab) && allSplitScreenTab.length > 0;
  const sshManagerTab = tabList.find((t) => t.type === "ssh_manager");
  const openSshManagerTab = () => {
    if (isSplitScreenActive) return;
    if (sshManagerTab) {
      setCurrentTab(sshManagerTab.id);
      return;
    }
    const id = addTab({ type: "ssh_manager", title: t("nav.hostManager") });
    setCurrentTab(id);
  };
  const adminTab = tabList.find((t) => t.type === "admin");
  const openAdminTab = () => {
    if (isSplitScreenActive) return;
    if (adminTab) {
      setCurrentTab(adminTab.id);
      return;
    }
    const id = addTab({ type: "admin" });
    setCurrentTab(id);
  };
  const userProfileTab = tabList.find((t) => t.type === "user_profile");
  const openUserProfileTab = () => {
    if (isSplitScreenActive) return;
    if (userProfileTab) {
      setCurrentTab(userProfileTab.id);
      return;
    }
    const id = addTab({ type: "user_profile" });
    setCurrentTab(id);
  };

  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [hostsLoading] = useState(false);
  const [hostsError, setHostsError] = useState<string | null>(null);
  const prevHostsRef = React.useRef<SSHHost[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [folderMetadata, setFolderMetadata] = useState<Map<string, SSHFolder>>(
    new Map(),
  );

  const fetchFolderMetadata = React.useCallback(async () => {
    try {
      const folders = await getSSHFolders();
      const metadataMap = new Map<string, SSHFolder>();
      folders.forEach((folder) => {
        metadataMap.set(folder.name, folder);
      });
      setFolderMetadata(metadataMap);
    } catch (error) {
      console.error("Failed to fetch folder metadata:", error);
    }
  }, []);

  const fetchHosts = React.useCallback(async () => {
    try {
      const newHosts = await getSSHHosts();
      const prevHosts = prevHostsRef.current;

      const existingHostsMap = new Map(prevHosts.map((h) => [h.id, h]));
      const newHostsMap = new Map(newHosts.map((h) => [h.id, h]));

      let hasChanges = false;

      if (newHosts.length !== prevHosts.length) {
        hasChanges = true;
      } else {
        for (const [id, newHost] of newHostsMap) {
          const existingHost = existingHostsMap.get(id);
          if (!existingHost) {
            hasChanges = true;
            break;
          }

          if (
            newHost.name !== existingHost.name ||
            newHost.folder !== existingHost.folder ||
            newHost.ip !== existingHost.ip ||
            newHost.port !== existingHost.port ||
            newHost.username !== existingHost.username ||
            newHost.pin !== existingHost.pin ||
            newHost.enableTerminal !== existingHost.enableTerminal ||
            newHost.enableTunnel !== existingHost.enableTunnel ||
            newHost.enableFileManager !== existingHost.enableFileManager ||
            newHost.authType !== existingHost.authType ||
            newHost.password !== existingHost.password ||
            newHost.key !== existingHost.key ||
            newHost.keyPassword !== existingHost.keyPassword ||
            newHost.keyType !== existingHost.keyType ||
            newHost.defaultPath !== existingHost.defaultPath ||
            JSON.stringify(newHost.tags) !==
              JSON.stringify(existingHost.tags) ||
            JSON.stringify(newHost.tunnelConnections) !==
              JSON.stringify(existingHost.tunnelConnections)
          ) {
            hasChanges = true;
            break;
          }
        }
      }

      if (hasChanges) {
        setTimeout(() => {
          setHosts(newHosts);
          prevHostsRef.current = newHosts;

          newHosts.forEach((newHost) => {
            updateHostConfig(newHost.id, newHost);
          });
        }, 50);
      }
    } catch {
      setHostsError(t("leftSidebar.failedToLoadHosts"));
    }
  }, [updateHostConfig]);

  React.useEffect(() => {
    fetchHosts();
    fetchFolderMetadata();
    const interval = setInterval(() => {
      fetchHosts();
      fetchFolderMetadata();
    }, 300000);
    return () => clearInterval(interval);
  }, [fetchHosts, fetchFolderMetadata]);

  React.useEffect(() => {
    const handleHostsChanged = () => {
      fetchHosts();
      fetchFolderMetadata();
    };
    const handleCredentialsChanged = () => {
      fetchHosts();
    };
    const handleFoldersChanged = () => {
      fetchFolderMetadata();
    };
    window.addEventListener(
      "ssh-hosts:changed",
      handleHostsChanged as EventListener,
    );
    window.addEventListener(
      "credentials:changed",
      handleCredentialsChanged as EventListener,
    );
    window.addEventListener(
      "folders:changed",
      handleFoldersChanged as EventListener,
    );
    return () => {
      window.removeEventListener(
        "ssh-hosts:changed",
        handleHostsChanged as EventListener,
      );
      window.removeEventListener(
        "credentials:changed",
        handleCredentialsChanged as EventListener,
      );
      window.removeEventListener(
        "folders:changed",
        handleFoldersChanged as EventListener,
      );
    };
  }, [fetchHosts, fetchFolderMetadata]);

  React.useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(handler);
  }, [search]);

  React.useEffect(() => {
    localStorage.setItem("leftSidebarOpen", JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem("leftSidebarWidth");
    const defaultWidth = 250;
    const savedWidth = saved !== null ? parseInt(saved, 10) : defaultWidth;
    const minWidth = Math.min(200, Math.floor(window.innerWidth * 0.15));
    const maxWidth = Math.floor(window.innerWidth * 0.3);
    return Math.min(savedWidth, Math.max(minWidth, maxWidth));
  });

  const [isResizing, setIsResizing] = useState(false);
  const startXRef = React.useRef<number | null>(null);
  const startWidthRef = React.useRef<number>(sidebarWidth);

  React.useEffect(() => {
    localStorage.setItem("leftSidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  React.useEffect(() => {
    const handleResize = () => {
      const minWidth = Math.min(200, Math.floor(window.innerWidth * 0.15));
      const maxWidth = Math.floor(window.innerWidth * 0.3);
      if (sidebarWidth > maxWidth) {
        setSidebarWidth(Math.max(minWidth, maxWidth));
      } else if (sidebarWidth < minWidth) {
        setSidebarWidth(minWidth);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [sidebarWidth]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
  };

  React.useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (startXRef.current == null) return;
      const dx = e.clientX - startXRef.current;
      const newWidth = Math.round(startWidthRef.current + dx);
      const minWidth = Math.min(200, Math.floor(window.innerWidth * 0.15));
      const maxWidth = Math.round(window.innerWidth * 0.3);
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setSidebarWidth(newWidth);
      } else if (newWidth < minWidth) {
        setSidebarWidth(minWidth);
      } else if (newWidth > maxWidth) {
        setSidebarWidth(maxWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      startXRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const filteredHosts = React.useMemo(() => {
    if (!debouncedSearch.trim()) return hosts;
    const searchQuery = debouncedSearch.trim().toLowerCase();

    return hosts.filter((h) => {
      // Check for field-specific search patterns
      const fieldMatches: Record<string, string> = {};
      let remainingQuery = searchQuery;

      // Extract field-specific queries (e.g., "tag:production", "user:root", "ip:192.168")
      const fieldPattern = /(\w+):([^\s]+)/g;
      let match;
      while ((match = fieldPattern.exec(searchQuery)) !== null) {
        const [fullMatch, field, value] = match;
        fieldMatches[field] = value;
        remainingQuery = remainingQuery.replace(fullMatch, "").trim();
      }

      // Handle field-specific searches
      for (const [field, value] of Object.entries(fieldMatches)) {
        switch (field) {
          case "tag":
          case "tags":
            const tags = Array.isArray(h.tags) ? h.tags : [];
            const hasMatchingTag = tags.some((tag) =>
              tag.toLowerCase().includes(value),
            );
            if (!hasMatchingTag) return false;
            break;
          case "name":
            if (!(h.name || "").toLowerCase().includes(value)) return false;
            break;
          case "user":
          case "username":
            if (!h.username.toLowerCase().includes(value)) return false;
            break;
          case "ip":
          case "host":
            if (!h.ip.toLowerCase().includes(value)) return false;
            break;
          case "port":
            if (!String(h.port).includes(value)) return false;
            break;
          case "folder":
            if (!(h.folder || "").toLowerCase().includes(value)) return false;
            break;
          case "auth":
          case "authtype":
            if (!h.authType.toLowerCase().includes(value)) return false;
            break;
          case "path":
            if (!(h.defaultPath || "").toLowerCase().includes(value))
              return false;
            break;
        }
      }

      // If there's remaining query text (not field-specific), search across all fields
      if (remainingQuery) {
        const searchableText = [
          h.name || "",
          h.username,
          h.ip,
          h.folder || "",
          ...(h.tags || []),
          h.authType,
          h.defaultPath || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!searchableText.includes(remainingQuery)) return false;
      }

      return true;
    });
  }, [hosts, debouncedSearch]);

  const hostsByFolder = React.useMemo(() => {
    const map: Record<string, SSHHost[]> = {};
    filteredHosts.forEach((h) => {
      const folder =
        h.folder && h.folder.trim() ? h.folder : t("leftSidebar.noFolder");
      if (!map[folder]) map[folder] = [];
      map[folder].push(h);
    });
    return map;
  }, [filteredHosts]);

  const sortedFolders = React.useMemo(() => {
    const folders = Object.keys(hostsByFolder);
    folders.sort((a, b) => {
      if (a === t("leftSidebar.noFolder")) return -1;
      if (b === t("leftSidebar.noFolder")) return 1;
      return a.localeCompare(b);
    });
    return folders;
  }, [hostsByFolder]);

  const getSortedHosts = React.useCallback((arr: SSHHost[]) => {
    const pinned = arr
      .filter((h) => h.pin)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const rest = arr
      .filter((h) => !h.pin)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return [...pinned, ...rest];
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden">
      <SidebarProvider
        open={isSidebarOpen}
        style={
          { "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties
        }
      >
        <div className="flex h-screen w-screen overflow-hidden">
          <Sidebar variant="floating">
            <SidebarHeader>
              <SidebarGroupLabel className="text-lg font-bold text-foreground">
                {t("common.appName")}
                <div className="absolute right-5 flex gap-1">
                  <Button
                    variant="outline"
                    onClick={() => setSidebarWidth(250)}
                    className="w-[28px] h-[28px]"
                    title={t("common.resetSidebarWidth")}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="w-[28px] h-[28px]"
                    title={t("common.toggleSidebar")}
                  >
                    <Menu className="h-4 w-4" />
                  </Button>
                </div>
              </SidebarGroupLabel>
            </SidebarHeader>
            <Separator className="p-0.25" />
            <SidebarContent>
              <SidebarGroup className="!m-0 !p-0 !-mb-2">
                <Button
                  className="m-2 flex flex-row font-semibold border-2 !border-edge"
                  variant="outline"
                  onClick={openSshManagerTab}
                  disabled={isSplitScreenActive}
                  title={
                    isSplitScreenActive
                      ? t("interface.disabledDuringSplitScreen")
                      : undefined
                  }
                >
                  <HardDrive strokeWidth="2.5" />
                  {t("nav.hostManager")}
                </Button>
              </SidebarGroup>
              <Separator className="p-0.25" />
              <SidebarGroup className="flex flex-col gap-y-2 !-mt-2">
                <div className="!bg-field rounded-lg">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("placeholders.searchHostsAny")}
                    className="w-full h-8 text-sm border-2 !bg-field border-edge rounded-md"
                    autoComplete="off"
                  />
                </div>

                {hostsError && (
                  <div className="!bg-field rounded-lg">
                    <div className="w-full h-8 text-sm border-2 !bg-field border-edge rounded-md px-3 py-1.5 flex items-center text-red-500">
                      {t("leftSidebar.failedToLoadHosts")}
                    </div>
                  </div>
                )}

                {hostsLoading && (
                  <div className="px-4 pb-2">
                    <div className="text-xs text-muted-foreground text-center">
                      {t("hosts.loadingHosts")}
                    </div>
                  </div>
                )}

                {sortedFolders.map((folder, idx) => {
                  const metadata = folderMetadata.get(folder);
                  return (
                    <FolderCard
                      key={`folder-${folder}-${hostsByFolder[folder]?.length || 0}`}
                      folderName={folder}
                      hosts={getSortedHosts(hostsByFolder[folder])}
                      isFirst={idx === 0}
                      isLast={idx === sortedFolders.length - 1}
                      folderColor={metadata?.color}
                      folderIcon={metadata?.icon}
                    />
                  );
                })}
              </SidebarGroup>
            </SidebarContent>
            <Separator className="p-0.25 mt-1 mb-1" />
            <SidebarFooter>
              <SidebarMenu>
                <SidebarMenuItem>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuButton
                        className="data-[state=open]:opacity-90 w-full"
                        disabled={disabled}
                      >
                        <User2 /> {username ? username : t("common.logout")}
                        <ChevronUp className="ml-auto" />
                      </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      side="top"
                      align="start"
                      sideOffset={6}
                      className="min-w-[var(--radix-popper-anchor-width)] bg-sidebar-accent text-sidebar-accent-foreground border border-border rounded-md shadow-2xl p-1"
                    >
                      <DropdownMenuItem
                        className="rounded px-2 py-1.5 hover:bg-surface-hover hover:text-accent-foreground focus:bg-surface-hover focus:text-accent-foreground cursor-pointer focus:outline-none"
                        onClick={() => {
                          openUserProfileTab();
                        }}
                      >
                        <span>{t("profile.title")}</span>
                      </DropdownMenuItem>
                      {isAdmin && (
                        <DropdownMenuItem
                          className="rounded px-2 py-1.5 hover:bg-surface-hover hover:text-accent-foreground focus:bg-surface-hover focus:text-accent-foreground cursor-pointer focus:outline-none"
                          onClick={() => {
                            if (isAdmin) openAdminTab();
                          }}
                        >
                          <span>{t("admin.title")}</span>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="rounded px-2 py-1.5 hover:bg-surface-hover hover:text-accent-foreground focus:bg-surface-hover focus:text-accent-foreground cursor-pointer focus:outline-none"
                        onClick={onLogout || handleLogout}
                      >
                        <span>{t("common.logout")}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>
            {isSidebarOpen && (
              <div
                className="absolute top-0 h-full cursor-col-resize z-[60]"
                onMouseDown={handleMouseDown}
                style={{
                  right: "-4px",
                  width: "8px",
                  backgroundColor: isResizing
                    ? "var(--bg-interact)"
                    : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!isResizing) {
                    e.currentTarget.style.backgroundColor =
                      "var(--border-hover)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isResizing) {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }
                }}
                title={t("common.dragToResizeSidebar")}
              />
            )}
          </Sidebar>

          <SidebarInset>{children}</SidebarInset>
        </div>
      </SidebarProvider>

      {!isSidebarOpen && (
        <div
          onClick={() => setIsSidebarOpen(true)}
          className="fixed top-0 left-0 w-[10px] h-full cursor-pointer flex items-center justify-center rounded-tr-md rounded-br-md"
          style={{
            zIndex: 9999,
            backgroundColor: "var(--bg-base)",
            border: "2px solid var(--border-base)",
            borderLeft: "none",
          }}
        >
          <ChevronRight size={10} />
        </div>
      )}
    </div>
  );
}
