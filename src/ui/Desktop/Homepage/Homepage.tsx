import React, { useEffect, useState } from "react";
import { Auth } from "@/ui/Desktop/Authentication/Auth.tsx";
import { HomepageUpdateLog } from "@/ui/Desktop/Homepage/Components/HompageUpdateLog.tsx";
import { HomepageAlertManager } from "@/ui/Desktop/Homepage/Alerts/HomepageAlertManager.tsx";
import { Recents } from "@/ui/Desktop/Homepage/Components/Recents.tsx";
import { ServerStats } from "@/ui/Desktop/Homepage/Components/ServerStats.tsx";
import { QuickAccess } from "@/ui/Desktop/Homepage/Components/QuickAccess.tsx";
import { Button } from "@/components/ui/button.tsx";
import { getUserInfo, getDatabaseHealth, getCookie } from "@/ui/main-axios.ts";
import { useTranslation } from "react-i18next";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { useKeyboardShortcuts, defaultShortcuts } from "@/hooks/useKeyboardShortcuts.ts";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable.tsx";

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
  isAdmin: boolean;
}

export function Homepage({
  onSelectView,
  isAuthenticated,
  authLoading,
  onAuthSuccess,
  isTopbarOpen,
  isAdmin,
}: HomepageProps): React.ReactElement {
  const { t } = useTranslation();
  
  let sidebarState = "collapsed";
  try {
    const sidebar = useSidebar();
    sidebarState = sidebar.state;
  } catch (error) {
    sidebarState = "collapsed";
  }
  const [loggedIn, setLoggedIn] = useState(isAuthenticated);
  const [localIsAdmin, setLocalIsAdmin] = useState(isAdmin);
  const [username, setUsername] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  // Keyboard shortcuts
  const shortcuts = defaultShortcuts.map(shortcut => ({
    ...shortcut,
    action: () => {
      if (shortcut.key === "h") onSelectView("homepage");
      else if (shortcut.key === "t") onSelectView("terminal");
      else if (shortcut.key === "f") onSelectView("file-manager");
      else if (shortcut.key === "n") onSelectView("host-manager");
      else if (shortcut.key === "k") onSelectView("credentials");
      else shortcut.action();
    }
  }));
  
  useKeyboardShortcuts(shortcuts);

  const topMarginPx = isTopbarOpen ? 74 : 16;
  const leftMarginPx = sidebarState === "collapsed" ? 16 : 8;
  const bottomMarginPx = 8;

  useEffect(() => {
    setLoggedIn(isAuthenticated);
  }, [isAuthenticated]);

  useEffect(() => {
    setLocalIsAdmin(isAdmin);
  }, [isAdmin]);

  useEffect(() => {
    if (isAuthenticated) {
      const jwt = getCookie("jwt");
      if (jwt) {
        Promise.all([getUserInfo(), getDatabaseHealth()])
          .then(([meRes]) => {
            setUsername(meRes.username || null);
            setUserId(meRes.userId || null);
            setDbError(null);
          })
          .catch((err) => {
            setUsername(null);
            setUserId(null);

            const errorCode = err?.response?.data?.code;
            if (errorCode === "SESSION_EXPIRED") {
              console.warn("Session expired - please log in again");
              setDbError("Session expired - please log in again");
            } else if (err?.response?.data?.error?.includes("Database")) {
              setDbError(
                "Could not connect to the database. Please try again later.",
              );
            } else {
              setDbError(null);
            }
          });
      }
    }
  }, [isAuthenticated]);

  const wrapperStyle: React.CSSProperties = {
    marginLeft: leftMarginPx,
    marginRight: 17,
    marginTop: topMarginPx,
    marginBottom: bottomMarginPx,
    height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
  };

  const containerClass =
    "bg-dark-bg text-white border-2 border-dark-border overflow-y-auto rounded-md";

  return (
    <>
      {!loggedIn ? (
        <div style={wrapperStyle} className="w-full h-full flex items-center justify-center">
          <Auth
            setLoggedIn={setLoggedIn}
            setIsAdmin={setLocalIsAdmin}
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
        <div style={wrapperStyle} className={containerClass}>
          <div className="h-full w-full flex flex-col">
            <ResizablePanelGroup
              direction="vertical"
              className="flex w-full h-full"
            >
              {/* Top Row */}
              <ResizablePanel defaultSize={50}>
                <ResizablePanelGroup
                  direction="horizontal"
                  className="flex w-full h-full"
                >
                  {/* Top Left: Recents */}
                  <ResizablePanel defaultSize={50}>
                    <div className="h-full">
                      <Recents onSelectView={onSelectView} />
                    </div>
                  </ResizablePanel>
                  <ResizableHandle className="bg-dark-border" />
                  {/* Top Right: Server Stats */}
                  <ResizablePanel defaultSize={50}>
                    <div className="h-full">
                      <ServerStats onSelectView={onSelectView} />
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
              
              <ResizableHandle className="bg-dark-border" />
              
              {/* Bottom Row */}
              <ResizablePanel defaultSize={50}>
                <ResizablePanelGroup
                  direction="horizontal"
                  className="flex w-full h-full"
                >
                  {/* Bottom Left: Empty for now */}
                  <ResizablePanel defaultSize={50}>
                    <div className="h-full bg-dark-bg border-0 rounded-none">
                      {/* Empty - tunnels section removed */}
                    </div>
                  </ResizablePanel>
                  <ResizableHandle className="bg-dark-border" />
                  {/* Bottom Right: Quick Access */}
                  <ResizablePanel defaultSize={50}>
                    <div className="h-full">
                      <QuickAccess onSelectView={onSelectView} isAdmin={localIsAdmin} loggedIn={loggedIn} />
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </div>
      )}

      <HomepageAlertManager userId={userId} loggedIn={loggedIn} />
    </>
  );
}
