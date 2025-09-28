import React, { useState } from "react";
import { ChevronUp, User2, HardDrive, Menu, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getCookie,
  setCookie,
  isElectron,
  logoutUser,
} from "@/ui/main-axios.ts";

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
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert.tsx";
import { FolderCard } from "@/ui/Desktop/Navigation/Hosts/FolderCard.tsx";
import { getSSHHosts } from "@/ui/main-axios.ts";
import { useTabs } from "@/ui/Desktop/Navigation/Tabs/TabContext.tsx";
import { deleteAccount } from "@/ui/main-axios.ts";

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

interface SidebarProps {
  onSelectView: (view: string) => void;
  getView?: () => string;
  disabled?: boolean;
  isAdmin?: boolean;
  username?: string | null;
  children?: React.ReactNode;
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
  onSelectView,
  getView,
  disabled,
  isAdmin,
  username,
  children,
}: SidebarProps): React.ReactElement {
  const { t } = useTranslation();

  const [deleteAccountOpen, setDeleteAccountOpen] = React.useState(false);
  const [deletePassword, setDeletePassword] = React.useState("");
  const [deleteLoading, setDeleteLoading] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

  const {
    tabs: tabList,
    addTab,
    setCurrentTab,
    allSplitScreenTab,
    updateHostConfig,
  } = useTabs() as any;
  const isSplitScreenActive =
    Array.isArray(allSplitScreenTab) && allSplitScreenTab.length > 0;
  const sshManagerTab = tabList.find((t) => t.type === "ssh_manager");
  const openSshManagerTab = () => {
    if (sshManagerTab || isSplitScreenActive) return;
    const id = addTab({ type: "ssh_manager" } as any);
    setCurrentTab(id);
  };
  const adminTab = tabList.find((t) => t.type === "admin");
  const openAdminTab = () => {
    if (isSplitScreenActive) return;
    if (adminTab) {
      setCurrentTab(adminTab.id);
      return;
    }
    const id = addTab({ type: "admin" } as any);
    setCurrentTab(id);
  };
  const userProfileTab = tabList.find((t) => t.type === "user_profile");
  const openUserProfileTab = () => {
    if (isSplitScreenActive) return;
    if (userProfileTab) {
      setCurrentTab(userProfileTab.id);
      return;
    }
    const id = addTab({ type: "user_profile" } as any);
    setCurrentTab(id);
  };

  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [hostsLoading, setHostsLoading] = useState(false);
  const [hostsError, setHostsError] = useState<string | null>(null);
  const prevHostsRef = React.useRef<SSHHost[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

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
            newHost.credentialId !== existingHost.credentialId ||
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
    } catch (err: any) {
      setHostsError(t("leftSidebar.failedToLoadHosts"));
    }
  }, [updateHostConfig]);

  React.useEffect(() => {
    fetchHosts();
    const interval = setInterval(fetchHosts, 300000);
    return () => clearInterval(interval);
  }, [fetchHosts]);

  React.useEffect(() => {
    const handleHostsChanged = () => {
      fetchHosts();
    };
    const handleCredentialsChanged = () => {
      fetchHosts();
    };
    window.addEventListener(
      "ssh-hosts:changed",
      handleHostsChanged as EventListener,
    );
    window.addEventListener(
      "credentials:changed",
      handleCredentialsChanged as EventListener,
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
    };
  }, [fetchHosts]);

  React.useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(handler);
  }, [search]);

  const filteredHosts = React.useMemo(() => {
    if (!debouncedSearch.trim()) return hosts;
    const q = debouncedSearch.trim().toLowerCase();
    return hosts.filter((h) => {
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
      return searchableText.includes(q);
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

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteLoading(true);
    setDeleteError(null);

    if (!deletePassword.trim()) {
      setDeleteError(t("leftSidebar.passwordRequired"));
      setDeleteLoading(false);
      return;
    }

    const jwt = getCookie("jwt");
    try {
      await deleteAccount(deletePassword);

      handleLogout();
    } catch (err: any) {
      setDeleteError(
        err?.response?.data?.error || t("leftSidebar.failedToDeleteAccount"),
      );
      setDeleteLoading(false);
    }
  };

  return (
    <div className="min-h-svh">
      <SidebarProvider open={isSidebarOpen}>
        <Sidebar variant="floating" className="">
          <SidebarHeader>
            <SidebarGroupLabel className="text-lg font-bold text-white">
              Termix
              <Button
                variant="outline"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="w-[28px] h-[28px] absolute right-5"
                title={t("common.toggleSidebar")}
              >
                <Menu className="h-4 w-4" />
              </Button>
            </SidebarGroupLabel>
          </SidebarHeader>
          <Separator className="p-0.25" />
          <SidebarContent>
            <SidebarGroup className="!m-0 !p-0 !-mb-2">
              <Button
                className="m-2 flex flex-row font-semibold border-2 !border-dark-border"
                variant="outline"
                onClick={openSshManagerTab}
                disabled={!!sshManagerTab || isSplitScreenActive}
                title={
                  sshManagerTab
                    ? t("interface.sshManagerAlreadyOpen")
                    : isSplitScreenActive
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
                <div className="!bg-dark-bg-input rounded-lg">
                  <div className="w-full h-8 text-sm border-2 !bg-dark-bg-input border-dark-border rounded-md px-3 py-1.5 flex items-center text-red-500">
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

              {sortedFolders.map((folder, idx) => (
                <FolderCard
                  key={`folder-${folder}-${hostsByFolder[folder]?.length || 0}`}
                  folderName={folder}
                  hosts={getSortedHosts(hostsByFolder[folder])}
                  isFirst={idx === 0}
                  isLast={idx === sortedFolders.length - 1}
                />
              ))}
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
                      className="rounded px-2 py-1.5 hover:bg-white/15 hover:text-accent-foreground focus:bg-white/20 focus:text-accent-foreground cursor-pointer focus:outline-none"
                      onClick={() => {
                        openUserProfileTab();
                      }}
                    >
                      <span>{t("profile.title")}</span>
                    </DropdownMenuItem>
                    {isAdmin && !isElectron() && (
                      <DropdownMenuItem
                        className="rounded px-2 py-1.5 hover:bg-white/15 hover:text-accent-foreground focus:bg-white/20 focus:text-accent-foreground cursor-pointer focus:outline-none"
                        onClick={() => {
                          if (isAdmin) openAdminTab();
                        }}
                      >
                        <span>{t("admin.title")}</span>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      className="rounded px-2 py-1.5 hover:bg-white/15 hover:text-accent-foreground focus:bg-white/20 focus:text-accent-foreground cursor-pointer focus:outline-none"
                      onClick={handleLogout}
                    >
                      <span>{t("common.logout")}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="rounded px-2 py-1.5 hover:bg-white/15 hover:text-accent-foreground focus:bg-white/20 focus:text-accent-foreground cursor-pointer focus:outline-none"
                      onClick={() => setDeleteAccountOpen(true)}
                    >
                      <span className="text-red-400">
                        {t("leftSidebar.deleteAccount")}
                      </span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>

      {!isSidebarOpen && (
        <div
          onClick={() => setIsSidebarOpen(true)}
          className="absolute top-0 left-0 w-[10px] h-full bg-dark-bg cursor-pointer z-20 flex items-center justify-center rounded-tr-md rounded-br-md"
        >
          <ChevronRight size={10} />
        </div>
      )}

      {deleteAccountOpen && (
        <div
          className="fixed top-0 left-0 right-0 bottom-0 z-[999999] pointer-events-auto isolate"
          style={{
            transform: "translateZ(0)",
            willChange: "z-index",
          }}
        >
          <div
            className="w-[400px] h-full bg-dark-bg border-r-2 border-dark-border flex flex-col shadow-2xl relative isolate z-[9999999]"
            style={{
              boxShadow: "4px 0 20px rgba(0, 0, 0, 0.5)",
              transform: "translateZ(0)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-dark-border">
              <h2 className="text-lg font-semibold text-white">
                {t("leftSidebar.deleteAccount")}
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDeleteAccountOpen(false);
                  setDeletePassword("");
                  setDeleteError(null);
                }}
                className="h-8 w-8 p-0 hover:bg-red-500 hover:text-white transition-colors flex items-center justify-center"
                title={t("leftSidebar.closeDeleteAccount")}
              >
                <span className="text-lg font-bold leading-none">×</span>
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
                <div className="text-sm text-gray-300">
                  {t("leftSidebar.deleteAccountWarning")}
                </div>

                <Alert variant="destructive">
                  <AlertTitle>{t("common.warning")}</AlertTitle>
                  <AlertDescription>
                    {t("leftSidebar.deleteAccountWarningDetails")}
                  </AlertDescription>
                </Alert>

                {deleteError && (
                  <Alert variant="destructive">
                    <AlertTitle>{t("common.error")}</AlertTitle>
                    <AlertDescription>{deleteError}</AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleDeleteAccount} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="delete-password">
                      {t("leftSidebar.confirmPassword")}
                    </Label>
                    <PasswordInput
                      id="delete-password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      placeholder={t("placeholders.confirmPassword")}
                      required
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      variant="destructive"
                      className="flex-1"
                      disabled={deleteLoading || !deletePassword.trim()}
                    >
                      {deleteLoading
                        ? t("leftSidebar.deleting")
                        : t("leftSidebar.deleteAccount")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setDeleteAccountOpen(false);
                        setDeletePassword("");
                        setDeleteError(null);
                      }}
                    >
                      {t("leftSidebar.cancel")}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          <div
            className="flex-1 cursor-pointer"
            onClick={() => {
              setDeleteAccountOpen(false);
              setDeletePassword("");
              setDeleteError(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
