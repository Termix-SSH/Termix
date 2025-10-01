import React, { useState, useEffect } from "react";
import { LeftSidebar } from "@/ui/Desktop/Navigation/LeftSidebar.tsx";
import { Homepage } from "@/ui/Desktop/Homepage/Homepage.tsx";
import { AppView } from "@/ui/Desktop/Navigation/AppView.tsx";
import { HostManager } from "@/ui/Desktop/Apps/Host Manager/HostManager.tsx";
import {
  TabProvider,
  useTabs,
} from "@/ui/Desktop/Navigation/Tabs/TabContext.tsx";
import { TopNavbar } from "@/ui/Desktop/Navigation/TopNavbar.tsx";
import { AdminSettings } from "@/ui/Desktop/Admin/AdminSettings.tsx";
import { UserProfile } from "@/ui/Desktop/User/UserProfile.tsx";
import { Toaster } from "@/components/ui/sonner.tsx";
import { VersionCheckModal } from "@/components/ui/version-check-modal.tsx";
import { getUserInfo, getCookie } from "@/ui/main-axios.ts";

function AppContent() {
  const [view, setView] = useState<string>("homepage");
  const [mountedViews, setMountedViews] = useState<Set<string>>(
    new Set(["homepage"]),
  );
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [showVersionCheck, setShowVersionCheck] = useState(true);
  const [isTopbarOpen, setIsTopbarOpen] = useState<boolean>(true);
  const { currentTab, tabs } = useTabs();

  useEffect(() => {
    const checkAuth = () => {
      setAuthLoading(true);
      getUserInfo()
        .then((meRes) => {
          setIsAuthenticated(true);
          setIsAdmin(!!meRes.is_admin);
          setUsername(meRes.username || null);

          if (!meRes.data_unlocked) {
            console.warn("User data is locked - re-authentication required");
            setIsAuthenticated(false);
            setIsAdmin(false);
            setUsername(null);
          }
        })
        .catch((err) => {
          setIsAuthenticated(false);
          setIsAdmin(false);
          setUsername(null);

          const errorCode = err?.response?.data?.code;
          if (errorCode === "SESSION_EXPIRED") {
            console.warn("Session expired - please log in again");
          }
        })
        .finally(() => setAuthLoading(false));
    };

    checkAuth();

    const handleStorageChange = () => checkAuth();
    window.addEventListener("storage", handleStorageChange);

    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const handleSelectView = (nextView: string) => {
    setMountedViews((prev) => {
      if (prev.has(nextView)) return prev;
      const next = new Set(prev);
      next.add(nextView);
      return next;
    });
    setView(nextView);
  };

  const handleAuthSuccess = (authData: {
    isAdmin: boolean;
    username: string | null;
    userId: string | null;
  }) => {
    setIsAuthenticated(true);
    setIsAdmin(authData.isAdmin);
    setUsername(authData.username);
  };

  const currentTabData = tabs.find((tab) => tab.id === currentTab);
  const showTerminalView =
    currentTabData?.type === "terminal" ||
    currentTabData?.type === "server" ||
    currentTabData?.type === "file_manager";
  const showHome = currentTabData?.type === "home";
  const showSshManager = currentTabData?.type === "ssh_manager";
  const showAdmin = currentTabData?.type === "admin";
  const showProfile = currentTabData?.type === "user_profile";

  return (
    <div>
      {showVersionCheck && (
        <VersionCheckModal
          onDismiss={() => setShowVersionCheck(false)}
          onContinue={() => setShowVersionCheck(false)}
          isAuthenticated={isAuthenticated}
        />
      )}

      {!isAuthenticated && !authLoading && !showVersionCheck && (
        <div>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(
                            135deg,
                            transparent 0%,
                            transparent 49%,
                            rgba(255, 255, 255, 0.03) 49%,
                            rgba(255, 255, 255, 0.03) 51%,
                            transparent 51%,
                            transparent 100%
                        )`,
              backgroundSize: "80px 80px",
            }}
          />
        </div>
      )}

      {!isAuthenticated && !authLoading && !showVersionCheck && (
        <div className="fixed inset-0 flex items-center justify-center z-[10000]">
          <Homepage
            onSelectView={handleSelectView}
            isAuthenticated={isAuthenticated}
            authLoading={authLoading}
            onAuthSuccess={handleAuthSuccess}
            isTopbarOpen={isTopbarOpen}
          />
        </div>
      )}

      {isAuthenticated && (
        <LeftSidebar
          onSelectView={handleSelectView}
          disabled={!isAuthenticated || authLoading}
          isAdmin={isAdmin}
          username={username}
        >
          <div
            className="h-screen w-full visible pointer-events-auto static overflow-hidden"
            style={{ display: showTerminalView ? "block" : "none" }}
          >
            <AppView isTopbarOpen={isTopbarOpen} />
          </div>

          {showHome && (
            <div className="h-screen w-full visible pointer-events-auto static overflow-hidden">
              <Homepage
                onSelectView={handleSelectView}
                isAuthenticated={isAuthenticated}
                authLoading={authLoading}
                onAuthSuccess={handleAuthSuccess}
                isTopbarOpen={isTopbarOpen}
              />
            </div>
          )}

          {showSshManager && (
            <div className="h-screen w-full visible pointer-events-auto static overflow-hidden">
              <HostManager
                onSelectView={handleSelectView}
                isTopbarOpen={isTopbarOpen}
              />
            </div>
          )}

          {showAdmin && (
            <div className="h-screen w-full visible pointer-events-auto static overflow-hidden">
              <AdminSettings isTopbarOpen={isTopbarOpen} />
            </div>
          )}

          {showProfile && (
            <div className="h-screen w-full visible pointer-events-auto static overflow-auto">
              <UserProfile isTopbarOpen={isTopbarOpen} />
            </div>
          )}

          <TopNavbar
            isTopbarOpen={isTopbarOpen}
            setIsTopbarOpen={setIsTopbarOpen}
          />
        </LeftSidebar>
      )}
      <Toaster
        position="bottom-right"
        richColors={false}
        closeButton
        duration={5000}
        offset={20}
      />
    </div>
  );
}

function DesktopApp() {
  return (
    <TabProvider>
      <AppContent />
    </TabProvider>
  );
}

export default DesktopApp;
