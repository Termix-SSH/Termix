import React, { useEffect, useState } from "react";
import { Auth } from "@/ui/Desktop/Authentication/Auth.tsx";
import { UpdateLog } from "@/ui/Desktop/Apps/Dashboard/Apps/UpdateLog.tsx";
import { AlertManager } from "@/ui/Desktop/Apps/Dashboard/Apps/Alerts/AlertManager.tsx";
import { Button } from "@/components/ui/button.tsx";
import { getUserInfo, getDatabaseHealth, getCookie } from "@/ui/main-axios.ts";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { Separator } from "@/components/ui/separator.tsx";
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
} from "lucide-react";
import { Status } from "@/components/ui/shadcn-io/status";
import { BsLightning } from "react-icons/bs";

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
}: DashboardProps): React.ReactElement {
  const [loggedIn, setLoggedIn] = useState(isAuthenticated);
  const [, setIsAdmin] = useState(false);
  const [, setUsername] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

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
              <div className="text-2xl text-white font-semibold">Dashboard</div>
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
                  GitHub
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
                  Support
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
                  Discord
                </Button>
                <Button
                  className="font-semibold"
                  variant="outline"
                  onClick={() =>
                    window.open("https://github.com/sponsors/LukeGus", "_blank")
                  }
                >
                  Donate
                </Button>
              </div>
            </div>

            <Separator className="mt-3 p-0.25" />

            <div className="flex flex-col h-screen my-5 mx-5 gap-4">
              <div className="flex flex-row flex-1 gap-4 min-h-0">
                <div className="flex-1 border-2 border-dark-border rounded-md bg-dark-bg-darker flex flex-col overflow-hidden">
                  <div className="flex flex-col mx-3 my-2 overflow-y-auto overflow-x-hidden">
                    <p className="text-xl font-semibold mb-3 mt-1 flex flex-row items-center">
                      <Server className="mr-3" />
                      Server Overview
                    </p>
                    <div className="bg-dark-bg w-full h-auto border-2 border-dark-border rounded-md px-3 py-3">
                      <div className="flex flex-row items-center justify-between mb-3">
                        <div className="flex flex-row items-center">
                          <History
                            size={20}
                            color="#FFFFFF"
                            className="shrink-0"
                          />
                          <p className="ml-2 leading-none">Version</p>
                        </div>

                        <div className="flex flex-row items-center">
                          <p className="leading-none text-muted-foreground">
                            v1.8.0
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="ml-2 text-sm border-1 text-green-400 border-dark-border"
                          >
                            Up to Date
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
                          <p className="ml-2 leading-none">Uptime</p>
                        </div>

                        <div className="flex flex-row items-center">
                          <p className="leading-none text-muted-foreground">
                            0d 0h 7m
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
                          <p className="ml-2 leading-none">Database</p>
                        </div>

                        <div className="flex flex-row items-center">
                          <p className="leading-none text-muted-foreground">
                            healthy
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col grid grid-cols-2 gap-2 mt-2">
                      <div className="flex flex-row items-center bg-dark-bg w-full h-auto mt-3 border-2 border-dark-border rounded-md px-3 py-3">
                        <Server
                          size={16}
                          color="#FFFFFF"
                          className="mr-3 shrink-0"
                        />
                        <p className="m-0 leading-none">Total Servers</p>
                      </div>
                      <div className="flex flex-row items-center bg-dark-bg w-full h-auto mt-3 border-2 border-dark-border rounded-md px-3 py-3">
                        <Network
                          size={16}
                          color="#FFFFFF"
                          className="mr-3 shrink-0"
                        />
                        <p className="m-0 leading-none">Total Tunnels</p>
                      </div>
                    </div>
                    <div className="flex flex-col grid grid-cols-2 gap-2 mt-2">
                      <div className="flex flex-row items-center bg-dark-bg w-full h-auto mt-3 border-2 border-dark-border rounded-md px-3 py-3">
                        <Key
                          size={16}
                          color="#FFFFFF"
                          className="mr-3 shrink-0"
                        />
                        <p className="m-0 leading-none">Total Credentials</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex-1 border-2 border-dark-border rounded-md bg-dark-bg-darker flex flex-col overflow-hidden">
                  <div className="flex flex-col mx-3 my-2 flex-1 overflow-hidden">
                    <div className="flex flex-row items-center justify-between mb-3 mt-1">
                      <p className="text-xl font-semibold flex flex-row items-center">
                        <Clock className="mr-3" />
                        Recent Activity
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-2 !border-dark-border h-7"
                      >
                        Reset
                      </Button>
                    </div>
                    <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] auto-rows-min overflow-y-auto overflow-x-hidden">
                      <Button
                        variant="outline"
                        className="border-2 !border-dark-border bg-dark-bg"
                      >
                        <Server size={20} className="shrink-0" />
                        <p className="truncate ml-2 font-semibold">Server #1</p>
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex flex-row flex-1 gap-4 min-h-0">
                <div className="flex-1 border-2 border-dark-border rounded-md bg-dark-bg-darker flex flex-col overflow-hidden">
                  <div className="flex flex-col mx-3 my-2 overflow-y-auto overflow-x-hidden">
                    <p className="text-xl font-semibold mb-3 mt-1 flex flex-row items-center">
                      <FastForward className="mr-3" />
                      Quick Actions
                    </p>
                    <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] auto-rows-min overflow-y-auto overflow-x-hidden">
                      <Button
                        variant="outline"
                        className="border-2 !border-dark-border flex flex-col items-center justify-center h-auto p-3"
                      >
                        <Server
                          className="shrink-0"
                          style={{ width: "40px", height: "40px" }}
                        />
                        <span className="font-semibold text-sm mt-2">
                          Add Host
                        </span>
                      </Button>
                      <Button
                        variant="outline"
                        className="border-2 !border-dark-border flex flex-col items-center justify-center h-auto p-3"
                      >
                        <Key
                          className="shrink-0"
                          style={{ width: "40px", height: "40px" }}
                        />
                        <span className="font-semibold text-sm mt-2">
                          Add Credential
                        </span>
                      </Button>
                      <Button
                        variant="outline"
                        className="border-2 !border-dark-border flex flex-col items-center justify-center h-auto p-3"
                      >
                        <Settings
                          className="shrink-0"
                          style={{ width: "40px", height: "40px" }}
                        />
                        <span className="font-semibold text-sm mt-2">
                          Admin Settings
                        </span>
                      </Button>
                      <Button
                        variant="outline"
                        className="border-2 !border-dark-border flex flex-col items-center justify-center h-auto p-3"
                      >
                        <User
                          className="shrink-0"
                          style={{ width: "40px", height: "40px" }}
                        />
                        <span className="font-semibold text-sm mt-2">
                          User Profile
                        </span>
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="flex-1 border-2 border-dark-border rounded-md bg-dark-bg-darker flex flex-col overflow-hidden">
                  <div className="flex flex-col mx-3 my-2 flex-1 overflow-hidden">
                    <p className="text-xl font-semibold mb-3 mt-1 flex flex-row items-center">
                      <ChartLine className="mr-3" />
                      Server Stats
                    </p>
                    <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] auto-rows-min overflow-y-auto overflow-x-hidden">
                      <Button
                        variant="outline"
                        className="border-2 !border-dark-border bg-dark-bg h-auto p-3"
                      >
                        <div className="flex flex-col w-full">
                          <div className="flex flex-row items-center mb-2">
                            <Server size={20} className="shrink-0" />
                            <p className="truncate ml-2 font-semibold">
                              Server #1
                            </p>
                          </div>
                          <div className="flex flex-row justify-between text-xs text-muted-foreground">
                            <span>CPU: 45%</span>
                            <span>RAM: 62%</span>
                          </div>
                        </div>
                      </Button>
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
