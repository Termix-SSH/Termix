import React, { useEffect, useState, useContext } from "react";
import { Auth } from "@/ui/desktop/authentication/Auth.tsx";
import { AlertManager } from "@/ui/desktop/apps/dashboard/apps/alerts/AlertManager.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  getUserInfo,
  getDatabaseHealth,
  getCookie,
  getUptime,
  getVersionInfo,
  getSSHHosts,
  getCredentials,
  getRecentActivity,
  resetRecentActivity,
  getServerMetricsById,
  registerMetricsViewer,
  sendMetricsHeartbeat,
  type RecentActivityItem,
} from "@/ui/main-axios.ts";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { Kbd } from "@/components/ui/kbd";
import { useTranslation } from "react-i18next";
import { Settings as SettingsIcon } from "lucide-react";
import { ServerOverviewCard } from "@/ui/desktop/apps/dashboard/cards/ServerOverviewCard";
import { RecentActivityCard } from "@/ui/desktop/apps/dashboard/cards/RecentActivityCard";
import { QuickActionsCard } from "@/ui/desktop/apps/dashboard/cards/QuickActionsCard";
import { ServerStatsCard } from "@/ui/desktop/apps/dashboard/cards/ServerStatsCard";
import { NetworkGraphCard } from "@/ui/desktop/apps/dashboard/cards/NetworkGraphCard";
import { useDashboardPreferences } from "@/ui/desktop/apps/dashboard/hooks/useDashboardPreferences";
import { DashboardSettingsDialog } from "@/ui/desktop/apps/dashboard/components/DashboardSettingsDialog";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader";

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
  rightSidebarOpen?: boolean;
  rightSidebarWidth?: number;
  initialDbError?: string | null;
}

export function Dashboard({
  isAuthenticated,
  authLoading,
  onAuthSuccess,
  isTopbarOpen,
  rightSidebarOpen = false,
  rightSidebarWidth = 400,
  initialDbError = null,
}: DashboardProps): React.ReactElement {
  const { t } = useTranslation();
  const [loggedIn, setLoggedIn] = useState(isAuthenticated);
  const [isAdmin, setIsAdmin] = useState(false);
  const [, setUsername] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(initialDbError);

  const [uptime, setUptime] = useState<string>("0d 0h 0m");
  const [versionStatus, setVersionStatus] = useState<
    "up_to_date" | "requires_update"
  >("up_to_date");
  const [versionText, setVersionText] = useState<string>("v1.8.0");
  const [dbHealth, setDbHealth] = useState<"healthy" | "error">("healthy");
  const [totalServers, setTotalServers] = useState<number>(0);
  const [totalTunnels, setTotalTunnels] = useState<number>(0);
  const [totalCredentials, setTotalCredentials] = useState<number>(0);
  const [updateCheckDisabled, setUpdateCheckDisabled] = useState<boolean>(
    localStorage.getItem("disableUpdateCheck") === "true",
  );
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>(
    [],
  );
  const [recentActivityLoading, setRecentActivityLoading] =
    useState<boolean>(true);
  const [serverStats, setServerStats] = useState<
    Array<{ id: number; name: string; cpu: number | null; ram: number | null }>
  >([]);
  const [serverStatsLoading, setServerStatsLoading] = useState<boolean>(true);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [viewerSessions, setViewerSessions] = useState<Map<number, string>>(
    new Map(),
  );
  const [initialLoading, setInitialLoading] = useState(true);

  const { addTab, setCurrentTab, tabs: tabList, updateTab } = useTabs();
  const {
    layout,
    loading: preferencesLoading,
    updateLayout,
    resetLayout,
  } = useDashboardPreferences(loggedIn);

  let sidebarState: "expanded" | "collapsed" = "expanded";
  let sidebarAvailable = false;
  try {
    const sidebar = useSidebar();
    sidebarState = sidebar.state;
    sidebarAvailable = true;
  } catch {}

  const topMarginPx = isTopbarOpen ? 74 : 26;
  const leftMarginPx = sidebarState === "collapsed" ? 26 : 8;
  const rightMarginPx = 17;
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

        const updateDisabled =
          localStorage.getItem("disableUpdateCheck") === "true";
        setUpdateCheckDisabled(updateDisabled);
        if (!updateDisabled) {
          const versionInfo = await getVersionInfo();
          setVersionText(`v${versionInfo.localVersion}`);
          if (
            versionInfo.status === "up_to_date" ||
            versionInfo.status === "requires_update"
          ) {
            setVersionStatus(versionInfo.status);
          }
        } else {
          const versionInfo = await getVersionInfo();
          setVersionText(`v${versionInfo.localVersion}`);
        }

        try {
          await getDatabaseHealth();
          setDbHealth("healthy");
        } catch {
          setDbHealth("error");
        }

        const hostsResponse = await getSSHHosts();
        const hosts = Array.isArray(hostsResponse) ? hostsResponse : [];
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
            } catch (error) {
              console.error("Dashboard operation failed:", error);
            }
          }
        }
        setTotalTunnels(totalTunnelsCount);

        const credentialsResponse = await getCredentials();
        const credentials = Array.isArray(credentialsResponse)
          ? credentialsResponse
          : [];
        setTotalCredentials(credentials.length);

        setRecentActivityLoading(true);
        const activityResponse = await getRecentActivity(35);
        const activity = Array.isArray(activityResponse)
          ? activityResponse
          : [];
        setRecentActivity(activity);
        setRecentActivityLoading(false);

        setServerStatsLoading(true);
        const newViewerSessions = new Map<number, string>();
        const serversWithStats = await Promise.all(
          hosts
            .slice(0, 50)
            .map(
              async (host: {
                id: number;
                name: string;
                authType?: string;
                statsConfig?: string | { metricsEnabled?: boolean };
              }) => {
                try {
                  let statsConfig: { metricsEnabled?: boolean } = {
                    metricsEnabled: true,
                  };
                  if (host.statsConfig) {
                    if (typeof host.statsConfig === "string") {
                      statsConfig = JSON.parse(host.statsConfig);
                    } else {
                      statsConfig = host.statsConfig;
                    }
                  }

                  if (statsConfig.metricsEnabled === false) {
                    return null;
                  }

                  if (host.authType === "none") {
                    return null;
                  }

                  if (host.authType === "opkssh") {
                    return null;
                  }

                  const existingSession = viewerSessions.get(host.id);
                  let sessionId = existingSession;

                  if (!existingSession) {
                    try {
                      const viewerResult = await registerMetricsViewer(host.id);
                      if (
                        viewerResult.success &&
                        viewerResult.viewerSessionId
                      ) {
                        sessionId = viewerResult.viewerSessionId;
                        newViewerSessions.set(host.id, sessionId);
                      }
                    } catch (error) {
                      console.error(
                        `Failed to register viewer for host ${host.id}:`,
                        error,
                      );
                    }
                  } else {
                    newViewerSessions.set(host.id, existingSession);
                  }

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
              },
            ),
        );
        setViewerSessions(newViewerSessions);
        const validServerStats = serversWithStats.filter(
          (
            server,
          ): server is {
            id: number;
            name: string;
            cpu: number | null;
            ram: number | null;
          } => server !== null && server.cpu !== null && server.ram !== null,
        );
        setServerStats(validServerStats);
        setServerStatsLoading(false);
      } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
        setRecentActivityLoading(false);
        setServerStatsLoading(false);
      } finally {
        setInitialLoading(false);
      }
    };

    fetchDashboardData();

    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, [loggedIn]);

  useEffect(() => {
    if (!loggedIn || viewerSessions.size === 0) return;

    const heartbeatInterval = setInterval(async () => {
      for (const [, sessionId] of viewerSessions) {
        try {
          await sendMetricsHeartbeat(sessionId);
        } catch (error) {
          console.error("Failed to send heartbeat:", error);
        }
      }
    }, 30000);

    return () => clearInterval(heartbeatInterval);
  }, [loggedIn, viewerSessions]);

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
      } else if (item.type === "server_stats") {
        addTab({
          type: "server_stats",
          title: item.hostName,
          hostConfig: host,
        });
      } else if (item.type === "tunnel") {
        addTab({
          type: "tunnel",
          title: item.hostName,
          hostConfig: host,
        });
      } else if (item.type === "docker") {
        addTab({
          type: "docker",
          title: item.hostName,
          hostConfig: host,
        });
      }
    });
  };

  const handleServerStatClick = (serverId: number, serverName: string) => {
    getSSHHosts().then((hosts) => {
      const host = hosts.find((h: { id: number }) => h.id === serverId);
      if (!host) return;

      addTab({
        type: "server_stats",
        title: serverName,
        hostConfig: host,
      });
    });
  };

  const handleAddHost = () => {
    const sshManagerTab = tabList.find((t) => t.type === "ssh_manager");
    if (sshManagerTab) {
      setCurrentTab(sshManagerTab.id);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("host-manager:add-host"));
      }, 100);
    } else {
      const id = addTab({
        type: "ssh_manager",
        title: "Host Manager",
        initialTab: "hosts",
      });
      setCurrentTab(id);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("host-manager:add-host"));
      }, 100);
    }
  };

  const handleAddCredential = () => {
    const sshManagerTab = tabList.find((t) => t.type === "ssh_manager");
    if (sshManagerTab) {
      setCurrentTab(sshManagerTab.id);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("host-manager:add-credential"));
      }, 100);
    } else {
      const id = addTab({
        type: "ssh_manager",
        title: "Host Manager",
        initialTab: "credentials",
      });
      setCurrentTab(id);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("host-manager:add-credential"));
      }, 100);
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
          className="bg-canvas text-foreground rounded-lg border-2 border-edge overflow-hidden flex min-w-0"
          style={{
            marginLeft: leftMarginPx,
            marginRight: rightSidebarOpen
              ? `calc(var(--right-sidebar-width, ${rightSidebarWidth}px) + 8px)`
              : rightMarginPx,
            marginTop: topMarginPx,
            marginBottom: bottomMarginPx,
            height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
            transition:
              "margin-left 200ms linear, margin-right 200ms linear, margin-top 200ms linear",
          }}
        >
          <div className="flex flex-col relative z-10 w-full h-full min-w-0">
            <SimpleLoader
              visible={initialLoading}
              message={t("dashboard.loading")}
            />
            <div className="flex flex-row items-center justify-between w-full px-3 mt-3 min-w-0 flex-wrap gap-2">
              <div className="flex flex-row items-center gap-3">
                <div className="text-2xl text-foreground font-semibold shrink-0">
                  {t("dashboard.title")}
                </div>
              </div>
              <div className="flex flex-row gap-3 flex-wrap min-w-0">
                <div className="flex flex-col items-center gap-4 justify-center mr-5 min-w-0 shrink">
                  <p className="text-muted-foreground text-sm whitespace-nowrap">
                    Press <Kbd>LShift</Kbd> twice to open the command palette
                  </p>
                </div>
                <Button
                  className="font-semibold shrink-0 !bg-canvas"
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
                  className="font-semibold shrink-0 !bg-canvas"
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
                  className="font-semibold shrink-0 !bg-canvas"
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
                  className="font-semibold shrink-0 !bg-canvas"
                  variant="outline"
                  onClick={() =>
                    window.open("https://github.com/sponsors/LukeGus", "_blank")
                  }
                >
                  {t("dashboard.donate")}
                </Button>
                <Button
                  className="font-semibold shrink-0 !bg-canvas"
                  variant="outline"
                  onClick={() => setSettingsDialogOpen(true)}
                >
                  <SettingsIcon />
                </Button>
              </div>
            </div>

            <Separator className="mt-3 p-0.25" />

            <div className="flex flex-col flex-1 my-5 mx-5 gap-4 min-h-0 min-w-0 overflow-auto">
              {!preferencesLoading && layout && (
                <div
                  className="grid gap-4"
                  style={{
                    gridTemplateColumns: "repeat(auto-fit, minmax(540px, 1fr))",
                    gridAutoRows: "minmax(300px, 1fr)",
                    minHeight: "100%",
                  }}
                >
                  {layout.cards
                    .filter((card) => card.enabled)
                    .sort((a, b) => a.order - b.order)
                    .map((card) => {
                      if (card.id === "server_overview") {
                        return (
                          <ServerOverviewCard
                            key={card.id}
                            loggedIn={loggedIn}
                            versionText={versionText}
                            versionStatus={versionStatus}
                            uptime={uptime}
                            dbHealth={dbHealth}
                            totalServers={totalServers}
                            totalTunnels={totalTunnels}
                            totalCredentials={totalCredentials}
                            updateCheckDisabled={updateCheckDisabled}
                          />
                        );
                      } else if (card.id === "recent_activity") {
                        return (
                          <RecentActivityCard
                            key={card.id}
                            activities={recentActivity}
                            loading={recentActivityLoading}
                            onReset={handleResetActivity}
                            onActivityClick={handleActivityClick}
                          />
                        );
                      } else if (card.id === "network_graph") {
                        return (
                          <NetworkGraphCard
                            key={card.id}
                            isTopbarOpen={isTopbarOpen}
                            rightSidebarOpen={rightSidebarOpen}
                            rightSidebarWidth={rightSidebarWidth}
                          />
                        );
                      } else if (card.id === "quick_actions") {
                        return (
                          <QuickActionsCard
                            key={card.id}
                            isAdmin={isAdmin}
                            onAddHost={handleAddHost}
                            onAddCredential={handleAddCredential}
                            onOpenAdminSettings={handleOpenAdminSettings}
                            onOpenUserProfile={handleOpenUserProfile}
                          />
                        );
                      } else if (card.id === "server_stats") {
                        return (
                          <ServerStatsCard
                            key={card.id}
                            serverStats={serverStats}
                            loading={serverStatsLoading}
                            onServerClick={handleServerStatClick}
                          />
                        );
                      }
                      return null;
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <AlertManager userId={userId} loggedIn={loggedIn} />

      {layout && (
        <DashboardSettingsDialog
          open={settingsDialogOpen}
          onOpenChange={setSettingsDialogOpen}
          currentLayout={layout}
          onSave={updateLayout}
          onReset={resetLayout}
        />
      )}
    </>
  );
}
