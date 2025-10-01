import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ChevronUp, Menu, User2 } from "lucide-react";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Separator } from "@/components/ui/separator.tsx";
import { FolderCard } from "@/ui/Mobile/Navigation/Hosts/FolderCard.tsx";
import { getSSHHosts, logoutUser } from "@/ui/main-axios.ts";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@radix-ui/react-dropdown-menu";

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
  tunnelConnections: any[];
  createdAt: string;
  updatedAt: string;
}

interface LeftSidebarProps {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (type: boolean) => void;
  onHostConnect: () => void;
  disabled?: boolean;
  username?: string | null;
}

async function handleLogout() {
  try {
    await logoutUser();
    window.location.reload();
  } catch (error) {
    console.error("Logout failed:", error);
    window.location.reload();
  }
}

export function LeftSidebar({
  isSidebarOpen,
  setIsSidebarOpen,
  onHostConnect,
  disabled,
  username,
}: LeftSidebarProps) {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [hostsLoading, setHostsLoading] = useState(false);
  const [hostsError, setHostsError] = useState<string | null>(null);
  const prevHostsRef = React.useRef<SSHHost[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const fetchHosts = useCallback(async () => {
    try {
      const newHosts = await getSSHHosts();
      const prevHosts = prevHostsRef.current;

      if (JSON.stringify(newHosts) !== JSON.stringify(prevHosts)) {
        setHosts(newHosts);
        prevHostsRef.current = newHosts;
      }
    } catch (err: any) {
      setHostsError(t("leftSidebar.failedToLoadHosts"));
    }
  }, [t]);

  useEffect(() => {
    fetchHosts();
    const interval = setInterval(fetchHosts, 300000);
    return () => clearInterval(interval);
  }, [fetchHosts]);

  useEffect(() => {
    const handleHostsChanged = () => {
      fetchHosts();
    };
    window.addEventListener(
      "ssh-hosts:changed",
      handleHostsChanged as EventListener,
    );
    return () =>
      window.removeEventListener(
        "ssh-hosts:changed",
        handleHostsChanged as EventListener,
      );
  }, [fetchHosts]);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(handler);
  }, [search]);

  const filteredHosts = useMemo(() => {
    if (!debouncedSearch.trim()) return hosts;
    const q = debouncedSearch.trim().toLowerCase();
    return hosts.filter((h) => {
      const searchableText = [
        h.name || "",
        h.username,
        h.ip,
        h.folder || "",
        ...(h.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      return searchableText.includes(q);
    });
  }, [hosts, debouncedSearch]);

  const hostsByFolder = useMemo(() => {
    const map: Record<string, SSHHost[]> = {};
    filteredHosts.forEach((h) => {
      const folder =
        h.folder && h.folder.trim() ? h.folder : t("leftSidebar.noFolder");
      if (!map[folder]) map[folder] = [];
      map[folder].push(h);
    });
    return map;
  }, [filteredHosts, t]);

  const sortedFolders = useMemo(() => {
    const folders = Object.keys(hostsByFolder);
    folders.sort((a, b) => {
      if (a === t("leftSidebar.noFolder")) return 1;
      if (b === t("leftSidebar.noFolder")) return -1;
      return a.localeCompare(b);
    });
    return folders;
  }, [hostsByFolder, t]);

  const getSortedHosts = useCallback((arr: SSHHost[]) => {
    const pinned = arr
      .filter((h) => h.pin)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const rest = arr
      .filter((h) => !h.pin)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return [...pinned, ...rest];
  }, []);

  return (
    <div className="">
      <SidebarProvider open={isSidebarOpen}>
        <Sidebar>
          <SidebarHeader>
            <SidebarGroupLabel className="text-lg font-bold text-white">
              Termix
              <Button
                variant="outline"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="w-[28px] h-[28px] absolute right-5"
              >
                <Menu className="h-4 w-4" />
              </Button>
            </SidebarGroupLabel>
          </SidebarHeader>
          <Separator />
          <SidebarContent>
            <SidebarGroup className="flex flex-col gap-y-2">
              <div className="!bg-dark-bg-input rounded-lg">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("placeholders.searchHostsAny")}
                  className="w-full h-8 text-sm border-2 !bg-dark-bg-input border-dark-border rounded-md"
                  autoComplete="off"
                />
              </div>

              {hostsError && (
                <div className="px-1">
                  <div className="text-xs text-red-500 bg-red-500/10 rounded-lg px-2 py-1 border w-full">
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

              {sortedFolders.map((folder) => (
                <FolderCard
                  key={`folder-${folder}`}
                  folderName={folder}
                  hosts={getSortedHosts(hostsByFolder[folder])}
                  onHostConnect={onHostConnect}
                />
              ))}
            </SidebarGroup>
          </SidebarContent>
          <Separator className="mt-1" />
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
                      className="rounded px-2 py-1.5 hover:bg-white/15 hover:text-accent-foreground focus:bg-white/20 focus:text-accent-foreground cursor-pointer focus:outline-none"
                      onClick={handleLogout}
                    >
                      <span>{t("common.logout")}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
      </SidebarProvider>
    </div>
  );
}
