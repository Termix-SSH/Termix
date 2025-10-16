import React, { useEffect, useState } from "react";
import { Auth } from "@/ui/Desktop/Authentication/Auth.tsx";
import { UpdateLog } from "@/ui/Desktop/Apps/Dashboard/Apps/UpdateLog.tsx";
import { AlertManager } from "@/ui/Desktop/Apps/Dashboard/Apps/Alerts/AlertManager.tsx";
import { Button } from "@/components/ui/button.tsx";
import { getUserInfo, getDatabaseHealth, getCookie } from "@/ui/main-axios.ts";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { ChartLine, History } from "lucide-react";
import { Status } from "@/components/ui/shadcn-io/status";

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
              <div className="flex flex-row flex-1 gap-4">
                <div className="flex-1 border-2 border-dark-border rounded-md bg-dark-bg-darker">
                  <div className="flex flex-col mx-3 my-2">
                    <p className="text-xl font-semibold mb-3 flex flex-row">
                      <ChartLine className="mr-3" />
                      Server Status
                    </p>
                    <div className="flex flex-row items-center">
                      <History color="#7393B3" />
                      <p className="ml-3">Version</p>
                    </div>
                  </div>
                </div>
                <div className="flex-1 border-2 border-dark-border rounded-md bg-dark-bg-darker">
                  test
                </div>
              </div>
              <div className="flex flex-row flex-1 gap-4">
                <div className="flex-1 border-2 border-dark-border rounded-md bg-dark-bg-darker">
                  test
                </div>
                <div className="flex-1 border-2 border-dark-border rounded-md bg-dark-bg-darker">
                  test
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
