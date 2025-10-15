import React, { useEffect, useState } from "react";
import { Auth } from "@/ui/Desktop/Authentication/Auth.tsx";
import { HomepageUpdateLog } from "@/ui/Desktop/Apps/Homepage/Apps/UpdateLog.tsx";
import { AlertManager } from "@/ui/Desktop/Apps/Homepage/Apps/Alerts/AlertManager.tsx";
import { Button } from "@/components/ui/button.tsx";
import { getUserInfo, getDatabaseHealth, getCookie } from "@/ui/main-axios.ts";
import { useSidebar } from "@/components/ui/sidebar.tsx";

interface HomepageProps {
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

export function Homepage({
  isAuthenticated,
  authLoading,
  onAuthSuccess,
  isTopbarOpen,
}: HomepageProps): React.ReactElement {
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
          className="bg-dark-bg text-white rounded-lg border-2 border-dark-border overflow-hidden flex items-center justify-center"
          style={{
            marginLeft: leftMarginPx,
            marginRight: 17,
            marginTop: topMarginPx,
            marginBottom: bottomMarginPx,
            height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
          }}
        >
          <div className="flex flex-col items-center justify-center gap-6 relative z-10">
            <HomepageUpdateLog loggedIn={loggedIn} />

            <div className="flex flex-row items-center gap-3 flex-wrap justify-center">
              <Button
                variant="outline"
                size="sm"
                className="text-sm border-dark-border text-gray-300 hover:text-white hover:bg-dark-bg transition-colors"
                onClick={() =>
                  window.open("https://github.com/Termix-SSH/Termix", "_blank")
                }
              >
                GitHub
              </Button>
              <div className="w-px h-4 bg-dark-border"></div>
              <Button
                variant="outline"
                size="sm"
                className="text-sm border-dark-border text-gray-300 hover:text-white hover:bg-dark-bg transition-colors"
                onClick={() =>
                  window.open(
                    "https://github.com/Termix-SSH/Termix/issues/new",
                    "_blank",
                  )
                }
              >
                Feedback
              </Button>
              <div className="w-px h-4 bg-dark-border"></div>
              <Button
                variant="outline"
                size="sm"
                className="text-sm border-dark-border text-gray-300 hover:text-white hover:bg-dark-bg transition-colors"
                onClick={() =>
                  window.open("https://discord.com/invite/jVQGdvHDrf", "_blank")
                }
              >
                Discord
              </Button>
              <div className="w-px h-4 bg-dark-border"></div>
              <Button
                variant="outline"
                size="sm"
                className="text-sm border-dark-border text-gray-300 hover:text-white hover:bg-dark-bg transition-colors"
                onClick={() =>
                  window.open("https://github.com/sponsors/LukeGus", "_blank")
                }
              >
                Donate
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertManager userId={userId} loggedIn={loggedIn} />
    </>
  );
}
