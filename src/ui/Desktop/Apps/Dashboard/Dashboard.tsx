import React, { useEffect, useState } from "react";
import { Auth } from "@/ui/Desktop/Authentication/Auth.tsx";
import { UpdateLog } from "@/ui/Desktop/Apps/Dashboard/Apps/UpdateLog.tsx";
import { AlertManager } from "@/ui/Desktop/Apps/Dashboard/Apps/Alerts/AlertManager.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  getUserInfo,
  getDatabaseHealth,
  getCookie,
  getUptime,
  getVersionInfo,
  getSSHHosts,
  getTunnelStatuses,
  getCredentials,
  getRecentActivity,
  resetRecentActivity,
  getServerMetricsById,
  type RecentActivityItem,
} from "@/ui/main-axios.ts";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { useTabs } from "@/ui/Desktop/Navigation/Tabs/TabContext.tsx";
import {
  ChartLine,
  Clock,
  Database,
  FastForward,
  History,
  Key,
  Network,
  Server,
  UserPlus,
  Settings,
  User,
  Loader2,
  Terminal,
  FolderOpen,
} from "lucide-react";
import { Status } from "@/components/ui/shadcn-io/status";
import { BsLightning } from "react-icons/bs";
import { useTranslation } from "react-i18next";

interface DashboardProps {
  onSelectView: (view: string) => void;
  isAuthenticated: boolean;
  authLoading: boolean;
  onAuthSuccess: (authData: {
    isAdmin: boolean;
    username: string | null;
    userId: string | null;
  }) => void;
  isTopbarOpen: boolean;
}

export function Dashboard({
  isAuthenticated,
  authLoading,
  onAuthSuccess,
  isTopbarOpen,
  onSelectView,
}: DashboardProps): React.ReactElement {
  const { t } = useTranslation();
  const [loggedIn, setLoggedIn] = useState(isAuthenticated);
  const [isAdmin, setIsAdmin] = useState(false);
  const [, setUsername] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  const [uptime, setUptime] = useState<string>("0d 0h 0m");
  const [versionStatus, setVersionStatus] = useState<
    "up_to_date" | "requires_update"
  >("up_to_date");
  const [versionText, setVersionText] = useState<string>("v1.8.0");
  const [dbHealth, setDbHealth] = useState<"healthy" | "error">("healthy");
  const [totalServers, setTotalServers] = useState<number>(0);
  const [totalTunnels, setTotalTunnels] = useState<number>(0);
  const [totalCredentials, setTotalCredentials] = useState<number>(0);
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>(
    [],
  );
  const [recentActivityLoading, setRecentActivityLoading] =
    useState<boolean>(true);
  const [serverStats, setServerStats] = useState<
    Array<{ id: number; name: string; cpu: number | null; ram: number | null }>
  >([]);
  const [serverStatsLoading, setServerStatsLoading] = useState<boolean>(true);

  const { addTab, setCurrentTab, tabs: tabList } = useTabs();

  let sidebarState: "expanded" | "collapsed" = "expanded";
  try {
    const sidebar = useSidebar();
    sidebarState = sidebar.state;
  } catch {}

  const topMarginPx = isTopbarOpen ? 74 : 26;
  const leftMarginPx = sidebarState === "collapsed" ? 26 : 8;
  const bottomMarginPx = 8;

  useEffect(() => {
    setLoggedIn(isAuthenticated);
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      if (getCookie("jwt")) {
        getUserInfo()
          .then((meRes) => {
            setIsAdmin(!!meRes.is_admin);
            setUsername(meRes.username || null);
            setUserId(meRes.userId || null);
            setDbError(null);
          })
          .catch((err) => {
            setIsAdmin(false);
            setUsername(null);
            setUserId(null);

            const errorCode = err?.response?.data?.code;
            if (errorCode === "SESSION_EXPIRED") {
              console.warn("Session expired - please log in again");
              setDbError("Session expired - please log in again");
            } else {
              setDbError(null);
            }
          });

        getDatabaseHealth()
          .then(() => {
            setDbError(null);
          })
          .catch((err) => {
            if (err?.response?.data?.error?.includes("Database")) {
              setDbError(
                "Could not connect to the database. Please try again later.",
              );
            }
          });
      }
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!loggedIn) return;

    const fetchDashboardData = async () => {
      try {
        const uptimeInfo = await getUptime();
        setUptime(uptimeInfo.formatted);

        const versionInfo = await getVersionInfo();
        setVersionText(`v${versionInfo.localVersion}`);
        setVersionStatus(versionInfo.status || "up_to_date");

        try {
          await getDatabaseHealth();
          setDbHealth("healthy");
        } catch {
          setDbHealth("error");
        }

        const hosts = await getSSHHosts();
        setTotalServers(hosts.length);

        let totalTunnelsCount = 0;
        for (const host of hosts) {
          if (host.tunnelConnections) {
            try {
              const tunnelConnections = Array.isArray(host.tunnelConnections)
                ? host.tunnelConnections
                : JSON.parse(host.tunnelConnections);
              if (Array.isArray(tunnelConnections)) {
                totalTunnelsCount += tunnelConnections.length;
              }
            } catch {}
          }
        }
        setTotalTunnels(totalTunnelsCount);

        const credentials = await getCredentials();
        setTotalCredentials(credentials.length);

        setRecentActivityLoading(true);
        const activity = await getRecentActivity(35);
        setRecentActivity(activity);
        setRecentActivityLoading(false);

        setServerStatsLoading(true);
        const serversWithStats = await Promise.all(
          hosts.slice(0, 5).map(async (host: { id: number; name: string }) => {
            try {
              const metrics = await getServerMetricsById(host.id);
              return {
                id: host.id,
                name: host.name || `Host ${host.id}`,
                cpu: metrics.cpu.percent,
                ram: metrics.memory.percent,
              };
            } catch {
              return {
                id: host.id,
                name: host.name || `Host ${host.id}`,
                cpu: null,
                ram: null,
              };
            }
          }),
        );
        setServerStats(serversWithStats);
        setServerStatsLoading(false);
      } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
        setRecentActivityLoading(false);
        setServerStatsLoading(false);
      }
    };

    fetchDashboardData();

    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, [loggedIn]);

  const handleResetActivity = async () => {
    try {
      await resetRecentActivity();
      setRecentActivity([]);
    } catch (error) {
      console.error("Failed to reset activity:", error);
    }
  };

  const handleActivityClick = (item: RecentActivityItem) => {
    getSSHHosts().then((hosts) => {
      const host = hosts.find((h: { id: number }) => h.id === item.hostId);
      if (!host) return;

      if (item.type === "terminal") {
        addTab({
          type: "terminal",
          title: item.hostName,
          hostConfig: host,
        });
      } else if (item.type === "file_manager") {
        addTab({
          type: "file_manager",
          title: item.hostName,
          hostConfig: host,
        });
      }
    });
  };

  const handleAddHost = () => {
    const sshManagerTab = tabList.find((t) => t.type === "ssh_manager");
    if (sshManagerTab) {
      setCurrentTab(sshManagerTab.id);
    } else {
      const id = addTab({
        type: "ssh_manager",
        title: "Host Manager",
        initialTab: "add_host",
      });
      setCurrentTab(id);
    }
  };

  const handleAddCredential = () => {
    const sshManagerTab = tabList.find((t) => t.type === "ssh_manager");
    if (sshManagerTab) {
      setCurrentTab(sshManagerTab.id);
    } else {
      const id = addTab({
        type: "ssh_manager",
        title: "Host Manager",
        initialTab: "add_credential",
      });
      setCurrentTab(id);
    }
  };

  const handleOpenAdminSettings = () => {
    const adminTab = tabList.find((t) => t.type === "admin");
    if (adminTab) {
      setCurrentTab(adminTab.id);
    } else {
      const id = addTab({ type: "admin", title: "Admin Settings" });
      setCurrentTab(id);
    }
  };

  const handleOpenUserProfile = () => {
    const userProfileTab = tabList.find((t) => t.type === "user_profile");
    if (userProfileTab) {
      setCurrentTab(userProfileTab.id);
    } else {
      const id = addTab({ type: "user_profile", title: "User Profile" });
      setCurrentTab(id);
    }
  };

  return (
    <>
      {!loggedIn ? (
        <div className="w-full h-full flex items-center justify-center">
          <Auth
            setLoggedIn={setLoggedIn}
            setIsAdmin={setIsAdmin}
            setUsername={setUsername}
            setUserId={setUserId}
            loggedIn={loggedIn}
            authLoading={authLoading}
            dbError={dbError}
            setDbError={setDbError}
            onAuthSuccess={onAuthSuccess}
          />
        </div>
      ) : (
        <div
          className="bg-dark-bg text-white rounded-lg border-2 border-dark-border overflow-hidden flex"
          style={{
            marginLeft: leftMarginPx,
            marginRight: 17,
            marginTop: topMarginPx,
            marginBottom: bottomMarginPx,
            height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
          }}
        >
          <div className="flex flex-col relative z-10 w-full h-full">
            <div className="flex flex-row items-center justify-between w-full px-3 mt-3">
              <div className="text-2xl text-white font-semibold">
                {t("dashboard.title")}
              </div>
              <div className="flex flex-row gap-3">
                <Button
                  className="font-semibold"
                  variant="outline"
                  onClick={() =>
                    window.open(
                      "https://github.com/Termix-SSH/Termix",
                      "_blank",
                    )
                  }
                >
                  {t("dashboard.github")}
                </Button>
                <Button
                  className="font-semibold"
                  variant="outline"
                  onClick={() =>
                    window.open(
                      "https://github.com/Termix-SSH/Support/issues/new",
                      "_blank",
                    )
                  }
                >
                  {t("dashboard.support")}
                </Button>
                <Button
                  className="font-semibold"
                  variant="outline"
                  onClick={() =>
                    window.open(
                      "https://discord.com/invite/jVQGdvHDrf",
                      "_blank",
                    )
                  }
                >
                  {t("dashboard.discord")}
                </Button>
                <Button
                  className="font-semibold"
                  variant="outline"
                  onClick={() =>
                    window.open("https://github.com/sponsors/LukeGus", "_blank")
                  }
                >
                  {t("dashboard.donate")}
                </Button>
              </div>
            </div>

            <Separator className="mt-3 p-0.25" />

            <div className="flex flex-col flex-1 my-5 mx-5 gap-4 min-h-0">
              <div className="flex flex-row flex-1 gap-4 min-h-0">
                <div className="flex-1 border-2 border-dark-border rounded-md bg-dark-bg-darker flex flex-col overflow-hidden">
                  <div className="flex flex-col mx-3 my-2 overflow-y-auto overflow-x-hidden">
                    <p className="text-xl font-semibold mb-3 mt-1 flex flex-row items-center">
                      <Server className="mr-3" />
                      {t("dashboard.serverOverview")}
                    </p>
                    <div className="bg-dark-bg w-full h-auto border-2 border-dark-border rounded-md px-3 py-3">
                      <div className="flex flex-row items-center justify-between mb-3">
                        <div className="flex flex-row items-center">
                          <History
                            size={20}
                            color="#FFFFFF"
                            className="shrink-0"
                          />
                          <p className="ml-2 leading-none">
                            {t("dashboard.version")}
                          </p>
                        </div>

                        <div className="flex flex-row items-center">
                          <p className="leading-none text-muted-foreground">
                            {versionText}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className={`ml-2 text-sm border-1 border-dark-border ${versionStatus === "up_to_date" ? "text-green-400" : "text-yellow-400"}`}
                          >
                            {versionStatus === "up_to_date"
                              ? t("dashboard.upToDate")
                              : t("dashboard.updateAvailable")}
                          </Button>
                          <UpdateLog loggedIn={loggedIn} />
                        </div>
                      </div>

                      <div className="flex flex-row items-center justify-between mb-5">
                        <div className="flex flex-row items-center">
                          <Clock
                            size={20}
                            color="#FFFFFF"
                            className="shrink-0"
                          />
                          <p className="ml-2 leading-none">
                            {t("dashboard.uptime")}
                          </p>
                        </div>

                        <div className="flex flex-row items-center">
                          <p className="leading-none text-muted-foreground">
                            {uptime}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-row items-center justify-between">
                        <div className="flex flex-row items-center">
                          <Database
                            size={20}
                            color="#FFFFFF"
                            className="shrink-0"
                          />
                          <p className="ml-2 leading-none">
                            {t("dashboard.database")}
                          </p>
                        </div>

                        <div className="flex flex-row items-center">
                          <p
                            className={`leading-none ${dbHealth === "healthy" ? "text-green-400" : "text-red-400"}`}
                          >
                            {dbHealth === "healthy"
                              ? t("dashboard.healthy")
                              : t("dashboard.error")}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col grid grid-cols-2 gap-2 mt-2">
                      <div className="flex flex-row items-center justify-between bg-dark-bg w-full h-auto mt-3 border-2 border-dark-border rounded-md px-3 py-3">
                        <div className="flex flex-row items-center">
                          <Server
                            size={16}
                            color="#FFFFFF"
                            className="mr-3 shrink-0"
                          />
                          <p className="m-0 leading-none">
                            {t("dashboard.totalServers")}
                          </p>
                        </div>
                        <p className="m-0 leading-none text-muted-foreground font-semibold">
                          {totalServers}
                        </p>
                      </div>
                      <div className="flex flex-row items-center justify-between bg-dark-bg w-full h-auto mt-3 border-2 border-dark-border rounded-md px-3 py-3">
                        <div className="flex flex-row items-center">
                          <Network
                            size={16}
                            color="#FFFFFF"
                            className="mr-3 shrink-0"
                          />
                          <p className="m-0 leading-none">
                            {t("dashboard.totalTunnels")}
                          </p>
                        </div>
                        <p className="m-0 leading-none text-muted-foreground font-semibold">
                          {totalTunnels}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col grid grid-cols-2 gap-2 mt-2">
                      <div className="flex flex-row items-center justify-between bg-dark-bg w-full h-auto mt-3 border-2 border-dark-border rounded-md px-3 py-3">
                        <div className="flex flex-row items-center">
                          <Key
                            size={16}
                            color="#FFFFFF"
                            className="mr-3 shrink-0"
                          />
                          <p className="m-0 leading-none">
                            {t("dashboard.totalCredentials")}
                          </p>
                        </div>
                        <p className="m-0 leading-none text-muted-foreground font-semibold">
                          {totalCredentials}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex-1 border-2 border-dark-border rounded-md bg-dark-bg-darker flex flex-col overflow-hidden">
                  <div className="flex flex-col mx-3 my-2 flex-1 overflow-hidden">
                    <div className="flex flex-row items-center justify-between mb-3 mt-1">
                      <p className="text-xl font-semibold flex flex-row items-center">
                        <Clock className="mr-3" />
                        {t("dashboard.recentActivity")}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-2 !border-dark-border h-7"
                        onClick={handleResetActivity}
                      >
                        {t("dashboard.reset")}
                      </Button>
                    </div>
                    <div
                      className={`grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] auto-rows-min overflow-x-hidden ${recentActivityLoading ? "overflow-y-hidden" : "overflow-y-auto"}`}
                    >
                      {recentActivityLoading ? (
                        <div className="flex flex-row items-center text-muted-foreground text-sm">
                          <Loader2 className="animate-spin mr-2" size={16} />
                          <span>{t("dashboard.loadingRecentActivity")}</span>
                        </div>
                      ) : recentActivity.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          {t("dashboard.noRecentActivity")}
                        </p>
                      ) : (
                        recentActivity.map((item) => (
                          <Button
                            key={item.id}
                            variant="outline"
                            className="border-2 !border-dark-border bg-dark-bg"
                            onClick={() => handleActivityClick(item)}
                          >
                            {item.type === "terminal" ? (
                              <Terminal size={20} className="shrink-0" />
                            ) : (
                              <FolderOpen size={20} className="shrink-0" />
                            )}
                            <p className="truncate ml-2 font-semibold">
                              {item.hostName}
                            </p>
                          </Button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex flex-row flex-1 gap-4 min-h-0">
                <div className="flex-1 border-2 border-dark-border rounded-md bg-dark-bg-darker flex flex-col overflow-hidden">
                  <div className="flex flex-col mx-3 my-2 overflow-y-auto overflow-x-hidden">
                    <p className="text-xl font-semibold mb-3 mt-1 flex flex-row items-center">
                      <FastForward className="mr-3" />
                      {t("dashboard.quickActions")}
                    </p>
                    <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] auto-rows-min overflow-y-auto overflow-x-hidden">
                      <Button
                        variant="outline"
                        className="border-2 !border-dark-border flex flex-col items-center justify-center h-auto p-3"
                        onClick={handleAddHost}
                      >
                        <Server
                          className="shrink-0"
                          style={{ width: "40px", height: "40px" }}
                        />
                        <span className="font-semibold text-sm mt-2">
                          {t("dashboard.addHost")}
                        </span>
                      </Button>
                      <Button
                        variant="outline"
                        className="border-2 !border-dark-border flex flex-col items-center justify-center h-auto p-3"
                        onClick={handleAddCredential}
                      >
                        <Key
                          className="shrink-0"
                          style={{ width: "40px", height: "40px" }}
                        />
                        <span className="font-semibold text-sm mt-2">
                          {t("dashboard.addCredential")}
                        </span>
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="outline"
                          className="border-2 !border-dark-border flex flex-col items-center justify-center h-auto p-3"
                          onClick={handleOpenAdminSettings}
                        >
                          <Settings
                            className="shrink-0"
                            style={{ width: "40px", height: "40px" }}
                          />
                          <span className="font-semibold text-sm mt-2">
                            {t("dashboard.adminSettings")}
                          </span>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="border-2 !border-dark-border flex flex-col items-center justify-center h-auto p-3"
                        onClick={handleOpenUserProfile}
                      >
                        <User
                          className="shrink-0"
                          style={{ width: "40px", height: "40px" }}
                        />
                        <span className="font-semibold text-sm mt-2">
                          {t("dashboard.userProfile")}
                        </span>
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="flex-1 border-2 border-dark-border rounded-md bg-dark-bg-darker flex flex-col overflow-hidden">
                  <div className="flex flex-col mx-3 my-2 flex-1 overflow-hidden">
                    <p className="text-xl font-semibold mb-3 mt-1 flex flex-row items-center">
                      <ChartLine className="mr-3" />
                      {t("dashboard.serverStats")}
                    </p>
                    <div
                      className={`grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] auto-rows-min overflow-x-hidden ${serverStatsLoading ? "overflow-y-hidden" : "overflow-y-auto"}`}
                    >
                      {serverStatsLoading ? (
                        <div className="flex flex-row items-center text-muted-foreground text-sm">
                          <Loader2 className="animate-spin mr-2" size={16} />
                          <span>{t("dashboard.loadingServerStats")}</span>
                        </div>
                      ) : serverStats.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          {t("dashboard.noServerData")}
                        </p>
                      ) : (
                        serverStats.map((server) => (
                          <Button
                            key={server.id}
                            variant="outline"
                            className="border-2 !border-dark-border bg-dark-bg h-auto p-3"
                          >
                            <div className="flex flex-col w-full">
                              <div className="flex flex-row items-center mb-2">
                                <Server size={20} className="shrink-0" />
                                <p className="truncate ml-2 font-semibold">
                                  {server.name}
                                </p>
                              </div>
                              <div className="flex flex-row justify-between text-xs text-muted-foreground">
                                <span>
                                  {t("dashboard.cpu")}:{" "}
                                  {server.cpu !== null
                                    ? `${server.cpu}%`
                                    : t("dashboard.notAvailable")}
                                </span>
                                <span>
                                  {t("dashboard.ram")}:{" "}
                                  {server.ram !== null
                                    ? `${server.ram}%`
                                    : t("dashboard.notAvailable")}
                                </span>
                              </div>
                            </div>
                          </Button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <AlertManager userId={userId} loggedIn={loggedIn} />
    </>
  );
}
