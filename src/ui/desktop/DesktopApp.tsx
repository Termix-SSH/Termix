import React, { useState, useEffect } from "react";
import { LeftSidebar } from "@/ui/desktop/navigation/LeftSidebar.tsx";
import { Dashboard } from "@/ui/desktop/apps/dashboard/Dashboard.tsx";
import { AppView } from "@/ui/desktop/navigation/AppView.tsx";
import { HostManager } from "@/ui/desktop/apps/host-manager/HostManager.tsx";
import {
  TabProvider,
  useTabs,
} from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { TopNavbar } from "@/ui/desktop/navigation/TopNavbar.tsx";
import { AdminSettings } from "@/ui/desktop/admin/AdminSettings.tsx";
import { UserProfile } from "@/ui/desktop/user/UserProfile.tsx";
import { Toaster } from "@/components/ui/sonner.tsx";
import { getUserInfo } from "@/ui/main-axios.ts";

function AppContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [isTopbarOpen, setIsTopbarOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem("topNavbarOpen");
    return saved !== null ? JSON.parse(saved) : true;
  });
  const { currentTab, tabs } = useTabs();

  useEffect(() => {
    const checkAuth = () => {
      setAuthLoading(true);
      getUserInfo()
        .then((meRes) => {
          // Check if response is actually HTML (Vite dev server page)
          if (typeof meRes === "string" || !meRes.username) {
            setIsAuthenticated(false);
            setIsAdmin(false);
            setUsername(null);
          } else {
            setIsAuthenticated(true);
            setIsAdmin(!!meRes.is_admin);
            setUsername(meRes.username || null);
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
        .finally(() => {
          setAuthLoading(false);
        });
    };

    checkAuth();

    const handleStorageChange = () => checkAuth();
    window.addEventListener("storage", handleStorageChange);

    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  useEffect(() => {
    localStorage.setItem("topNavbarOpen", JSON.stringify(isTopbarOpen));
  }, [isTopbarOpen]);

  const handleSelectView = () => {};

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
      {!isAuthenticated && !authLoading && (
        <div className="fixed inset-0 flex items-center justify-center z-[10000]">
          <Dashboard
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
              <Dashboard
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
                initialTab={currentTabData?.initialTab}
                hostConfig={currentTabData?.hostConfig}
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
